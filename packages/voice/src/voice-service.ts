/**
 * @fileoverview VoiceService - Speech-to-text and text-to-speech coordination.
 *
 * The VoiceService orchestrates voice interactions by:
 * - Transcribing audio input through STT providers
 * - Parsing transcriptions into structured commands
 * - Synthesizing speech through TTS providers
 * - Managing audio file caching for TTS
 * - Emitting events for state changes
 *
 * Design Patterns:
 * - Strategy Pattern: Pluggable STT/TTS providers via ISTTProvider/ITTSProvider
 * - Caching: SHA256-based cache keys avoid re-synthesizing identical phrases
 *
 * @module voice/voice-service
 */

import type {
  ISTTProvider,
  ITTSProvider,
  IEventBus,
  AgentId,
  TranscriptionResult,
  TTSOptions,
} from '@jam/core';
import { createLogger } from '@jam/core';
import { CommandParser, type ParsedCommand } from './command-parser.js';

const log = createLogger('VoiceService');

/**
 * Configuration options for the VoiceService.
 *
 * @interface
 */
export interface VoiceServiceConfig {
  /** Speech-to-text provider (Whisper, ElevenLabs, etc.) */
  sttProvider: ISTTProvider;

  /** Text-to-speech provider (OpenAI, ElevenLabs, etc.) */
  ttsProvider: ITTSProvider;

  /** Event bus for emitting voice events */
  eventBus: IEventBus;

  /** Directory for caching synthesized audio files */
  audioCacheDir: string;

  /** Optional injected command parser (defaults to new instance if not provided) */
  commandParser?: CommandParser;
}

/**
 * Coordinates voice interactions between STT and TTS providers.
 *
 * This service provides:
 * - Audio transcription with agent name hints for better accuracy
 * - Command parsing to extract agent names and command types
 * - Text-to-speech synthesis with caching
 * - Streaming TTS for lower latency
 *
 * @class
 *
 * @example
 * ```typescript
 * const voiceService = new VoiceService({
 *   sttProvider: new WhisperSTTProvider(apiKey, model),
 *   ttsProvider: new OpenAITTSProvider(apiKey),
 *   eventBus: new EventBus(),
 *   audioCacheDir: '/path/to/cache'
 * });
 *
 * // Transcribe audio
 * const result = await voiceService.transcribe(audioBuffer);
 *
 * // Synthesize speech
 * const audioPath = await voiceService.synthesize("Hello world", "alloy", "agent-1");
 * ```
 */
export class VoiceService {
  /** Speech-to-text provider instance */
  private sttProvider: ISTTProvider;

  /** Text-to-speech provider instance */
  private ttsProvider: ITTSProvider;

  /** Event bus for emitting voice events */
  private eventBus: IEventBus;

  /** Command parser for extracting agent names and command types */
  private commandParser: CommandParser;

  /** Directory for caching synthesized audio files */
  private audioCacheDir: string;

  /**
   * Creates a new VoiceService instance.
   *
   * @param config - Service configuration including providers and event bus
   */
  constructor(config: VoiceServiceConfig) {
    this.sttProvider = config.sttProvider;
    this.ttsProvider = config.ttsProvider;
    this.eventBus = config.eventBus;
    this.commandParser = config.commandParser ?? new CommandParser();
    this.audioCacheDir = config.audioCacheDir;
  }

  /**
   * Updates the agent names available for voice command parsing.
   *
   * This is called when agents are created/deleted to keep the parser
   * in sync with the current agent roster.
   *
   * @param agents - Array of agent IDs and names
   */
  updateAgentNames(agents: Array<{ id: AgentId; name: string }>): void {
    this.commandParser.updateAgentNames(agents);
  }

  /**
   * Transcribes audio to text using the configured STT provider.
   *
   * This method:
   * 1. Emits a 'processing' state change event
   * 2. Passes agent names as a prompt hint to Whisper (improves accuracy)
   * 3. Calls the STT provider to transcribe the audio
   * 4. Emits the transcription result
   * 5. Returns to 'idle' state
   *
   * @param audio - Audio buffer to transcribe
   * @returns Promise resolving to the transcription result
   *
   * @throws {Error} If transcription fails
   */
  async transcribe(audio: Buffer): Promise<TranscriptionResult> {
    this.eventBus.emit('voice:stateChanged', { state: 'processing' });
    log.debug(`Transcribing audio chunk (${audio.length} bytes)`);

    try {
      // Pass agent names as prompt hints — helps Whisper recognize domain terms
      const agentNames = this.commandParser.getAgentNames();
      const prompt = agentNames.length > 0
        ? `Agent names: ${agentNames.join(', ')}.`
        : undefined;

      const result = await this.sttProvider.transcribe(audio, { language: 'en', prompt });
      log.info(`Transcription: "${result.text}" (confidence: ${result.confidence})`);

      this.eventBus.emit('voice:transcription', {
        text: result.text,
        isFinal: true,
        confidence: result.confidence,
      });

      return result;
    } catch (error) {
      log.error(`Transcription failed: ${String(error)}`);
      throw error;
    } finally {
      this.eventBus.emit('voice:stateChanged', { state: 'idle' });
    }
  }

  /**
   * Parses a transcription into a structured command.
   *
   * Delegates to the CommandParser to extract:
   * - Target agent name (if specified)
   * - Command type (task, status-query, interrupt, meta)
   * - Cleaned command text
   *
   * @param transcript - The transcribed text
   * @returns The parsed command structure
   */
  parseCommand(transcript: string): ParsedCommand {
    return this.commandParser.parse(transcript);
  }

  /**
   * Resolves an agent name to an agent ID.
   *
   * This is used by the CommandRouter to find the target agent
   * for a voice command.
   *
   * @param name - The agent name to resolve
   * @returns The agent ID, or undefined if not found
   */
  resolveAgentId(name: string): AgentId | undefined {
    return this.commandParser.resolveAgentId(name);
  }

  /**
   * Synthesizes text to speech with caching.
   *
   * This method:
   * 1. Computes a SHA256 cache key from (voiceId, speed, text)
   * 2. Checks if the audio is already cached
   * 3. If cache miss, calls the TTS provider to synthesize
   * 4. Writes the audio buffer to the cache directory
   * 5. Returns the file path to the cached audio
   *
   * The cache key includes speed so different speeds produce separate files.
   *
   * @async
   * @param text - The text to synthesize
   * @param voiceId - The voice ID to use (e.g., 'alloy', 'nova')
   * @param agentId - The agent ID (for logging and events)
   * @param options - Optional TTS parameters (speed, etc.)
   * @returns Promise resolving to the file path of the cached audio
   *
   * @throws {Error} If synthesis fails
   */
  async synthesize(
    text: string,
    voiceId: string,
    agentId: AgentId,
    options?: TTSOptions,
  ): Promise<string> {
    this.eventBus.emit('voice:stateChanged', { state: 'speaking' });

    try {
      const { createHash } = await import('node:crypto');
      const { writeFile, mkdir, access } = await import('node:fs/promises');
      const { join } = await import('node:path');

      // Include speed in cache key so different speeds produce separate files
      const speed = options?.speed ?? 1.0;
      const hash = createHash('sha256')
        .update(`${voiceId}:${speed}:${text}`)
        .digest('hex')
        .slice(0, 16);
      const audioPath = join(this.audioCacheDir, `${hash}.mp3`);

      try {
        await access(audioPath);
        // Cache hit
        this.eventBus.emit('tts:complete', { agentId, audioPath });
        return audioPath;
      } catch {
        // Cache miss - synthesize
      }

      log.debug(`Synthesizing TTS for voice ${voiceId} (speed=${speed})`, undefined, agentId);
      const audioBuffer = await this.ttsProvider.synthesize(text, voiceId, options);

      await mkdir(this.audioCacheDir, { recursive: true });
      await writeFile(audioPath, audioBuffer);
      log.info(`TTS audio cached: ${audioPath}`, undefined, agentId);

      this.eventBus.emit('tts:complete', { agentId, audioPath });
      return audioPath;
    } finally {
      this.eventBus.emit('voice:stateChanged', { state: 'idle' });
    }
  }

  /**
   * Streams TTS audio chunks for lower latency playback.
   *
   * This method provides streaming synthesis for faster playback start:
   * 1. Checks if the provider supports streaming
   * 2. If yes, streams chunks via onChunk callback as they arrive
   * 3. If no, falls back to non-streaming synthesis
   *
   * Note: Cached audio is not used for streaming - streaming bypasses
   * cache for speed. The cache is only used by the non-streaming synthesize() method.
   *
   * @async
   * @param text - The text to synthesize
   * @param voiceId - The voice ID to use
   * @param agentId - The agent ID (for logging)
   * @param onChunk - Callback for each audio chunk (Buffer, isComplete)
   * @param options - Optional TTS parameters (speed, etc.)
   * @returns Promise that resolves when streaming completes
   */
  async synthesizeStream(
    text: string,
    voiceId: string,
    agentId: AgentId,
    onChunk: (chunk: Buffer, isComplete: boolean) => void,
    options?: TTSOptions,
  ): Promise<void> {
    this.eventBus.emit('voice:stateChanged', { state: 'speaking' });

    try {
      // Check if provider supports streaming
      if ('synthesizeStream' in this.ttsProvider && typeof this.ttsProvider.synthesizeStream === 'function') {
        log.debug(`Using streaming TTS for voice ${voiceId}`, undefined, agentId);
        await this.ttsProvider.synthesizeStream!(text, voiceId, onChunk, options);
      } else {
        // Fallback: use non-streaming and emit as a single chunk
        log.debug(`Provider does not support streaming, using fallback`, undefined, agentId);
        const audioBuffer = await this.ttsProvider.synthesize(text, voiceId, options);
        onChunk(audioBuffer, true);
      }
    } finally {
      this.eventBus.emit('voice:stateChanged', { state: 'idle' });
    }
  }
}
