import type { ITTSProvider, VoiceInfo, TTSOptions } from '@jam/core';
import { createLogger } from '@jam/core';

const log = createLogger('ElevenLabsTTS');

const ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io/v1';

export class ElevenLabsTTSProvider implements ITTSProvider {
  readonly providerId = 'elevenlabs';

  constructor(private apiKey: string) {}

  async synthesize(
    text: string,
    voiceId: string,
    options?: TTSOptions,
  ): Promise<Buffer> {
    const response = await fetch(
      `${ELEVENLABS_BASE_URL}/text-to-speech/${voiceId}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': this.apiKey,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_multilingual_v2',
          voice_settings: {
            stability: options?.stability ?? 0.5,
            similarity_boost: options?.similarityBoost ?? 0.75,
            speed: options?.speed ?? 1.0,
          },
        }),
        signal: AbortSignal.timeout(30_000),
      },
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`ElevenLabs API error (${response.status}): ${error}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Stream TTS audio chunks using ElevenLabs' streaming endpoint.
   * This provides lower latency as audio starts playing before full synthesis completes.
   */
  async synthesizeStream(
    text: string,
    voiceId: string,
    onChunk: (chunk: Buffer, isComplete: boolean) => void,
    options?: TTSOptions,
  ): Promise<void> {
    log.debug(`Starting ElevenLabs streaming TTS for ${text.slice(0, 50)}...`);

    try {
      // Use ElevenLabs' streaming endpoint for lower latency
      const response = await fetch(
        `${ELEVENLABS_BASE_URL}/text-to-speech/${voiceId}/stream`,
        {
          method: 'POST',
          headers: {
            'xi-api-key': this.apiKey,
            'Content-Type': 'application/json',
            Accept: 'audio/mpeg',
          },
          body: JSON.stringify({
            text,
            model_id: 'eleven_multilingual_v2',
            voice_settings: {
              stability: options?.stability ?? 0.5,
              similarity_boost: options?.similarityBoost ?? 0.75,
              speed: options?.speed ?? 1.0,
            },
            output_format: 'mp3_44100_128',
          }),
        },
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`ElevenLabs API error (${response.status}): ${error}`);
      }

      if (!response.body) {
        throw new Error('Response body is null');
      }

      // Stream the response as chunks
      const reader = response.body.getReader();
      let totalBytes = 0;

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          // Send final completion signal
          log.debug(`ElevenLabs streaming TTS complete: ${totalBytes} bytes total`);
          onChunk(Buffer.alloc(0), true);
          break;
        }

        // Emit chunk immediately for low-latency playback
        const chunk = Buffer.from(value);
        totalBytes += chunk.length;

        log.debug(`Emitting ElevenLabs TTS chunk: ${chunk.length} bytes`);
        onChunk(chunk, false);
      }
    } catch (error) {
      log.error(`ElevenLabs streaming TTS failed: ${String(error)}`);
      throw error;
    }
  }

  async listVoices(): Promise<VoiceInfo[]> {
    const response = await fetch(`${ELEVENLABS_BASE_URL}/voices`, {
      headers: {
        'xi-api-key': this.apiKey,
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`ElevenLabs API error (${response.status}): ${error}`);
    }

    const data = (await response.json()) as {
      voices: Array<{ voice_id: string; name: string; preview_url?: string }>;
    };

    return data.voices.map(
      (voice: { voice_id: string; name: string; preview_url?: string }) => ({
        id: voice.voice_id,
        name: voice.name,
        previewUrl: voice.preview_url,
      }),
    );
  }
}
