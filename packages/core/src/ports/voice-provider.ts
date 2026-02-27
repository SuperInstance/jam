import type {
  TranscriptionResult,
  VoiceInfo,
  STTOptions,
  TTSOptions,
} from '../models/voice.js';

export interface ISTTProvider {
  readonly providerId: string;
  transcribe(audio: Buffer, options?: STTOptions): Promise<TranscriptionResult>;
}

export interface ITTSProvider {
  readonly providerId: string;
  synthesize(text: string, voiceId: string, options?: TTSOptions): Promise<Buffer>;
  listVoices(): Promise<VoiceInfo[]>;
  /** Optional streaming synthesis - emits audio chunks as they're generated */
  synthesizeStream?(
    text: string,
    voiceId: string,
    onChunk: (chunk: Buffer, isComplete: boolean) => void,
    options?: TTSOptions,
  ): Promise<void>;
}
