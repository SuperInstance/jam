import type { ITTSProvider, VoiceInfo, TTSOptions } from '@jam/core';
import { createLogger } from '@jam/core';

const log = createLogger('OpenAITTS');

const OPENAI_VOICES: VoiceInfo[] = [
  { id: 'alloy', name: 'Alloy' },
  { id: 'ash', name: 'Ash' },
  { id: 'ballad', name: 'Ballad' },
  { id: 'coral', name: 'Coral' },
  { id: 'echo', name: 'Echo' },
  { id: 'fable', name: 'Fable' },
  { id: 'onyx', name: 'Onyx' },
  { id: 'nova', name: 'Nova' },
  { id: 'sage', name: 'Sage' },
  { id: 'shimmer', name: 'Shimmer' },
];

/**
 * Chunk size for streaming audio data (64KB).
 * Smaller chunks reduce latency but may increase overhead.
 */
const STREAM_CHUNK_SIZE = 64 * 1024;

export class OpenAITTSProvider implements ITTSProvider {
  readonly providerId = 'openai';

  constructor(private apiKey: string) {}

  async synthesize(
    text: string,
    voiceId: string,
    options?: TTSOptions,
  ): Promise<Buffer> {
    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tts-1',
        input: text,
        voice: voiceId || 'alloy',
        speed: options?.speed ?? 1.0,
        response_format: 'mp3',
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI TTS API error (${response.status}): ${error}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Stream TTS audio chunks as they're received.
   * Note: OpenAI's API doesn't support server-side streaming, so we implement
   * client-side streaming by chunking the response as it downloads.
   */
  async synthesizeStream(
    text: string,
    voiceId: string,
    onChunk: (chunk: Buffer, isComplete: boolean) => void,
    options?: TTSOptions,
  ): Promise<void> {
    log.debug(`Starting streaming TTS for ${text.slice(0, 50)}...`);

    try {
      const response = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'tts-1',
          input: text,
          voice: voiceId || 'alloy',
          speed: options?.speed ?? 1.0,
          response_format: 'mp3',
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`OpenAI TTS API error (${response.status}): ${error}`);
      }

      if (!response.body) {
        throw new Error('Response body is null');
      }

      // Stream the response as chunks
      const reader = response.body.getReader();
      const chunks: Buffer[] = [];
      let totalBytes = 0;

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          // Send final completion signal
          log.debug(`Streaming TTS complete: ${totalBytes} bytes total`);
          onChunk(Buffer.alloc(0), true);
          break;
        }

        // Emit chunk immediately for low-latency playback
        const chunk = Buffer.from(value);
        chunks.push(chunk);
        totalBytes += chunk.length;

        log.debug(`Emitting TTS chunk: ${chunk.length} bytes`);
        onChunk(chunk, false);
      }
    } catch (error) {
      log.error(`Streaming TTS failed: ${String(error)}`);
      throw error;
    }
  }

  async listVoices(): Promise<VoiceInfo[]> {
    return OPENAI_VOICES;
  }
}
