export type VoiceState = 'idle' | 'capturing' | 'processing' | 'speaking';

export interface TranscriptionResult {
  text: string;
  confidence: number;
  language?: string;
  /** Whisper's no_speech_prob — probability that audio contains no speech (0.0 = speech, 1.0 = noise) */
  noSpeechProb?: number;
}

export interface VoiceInfo {
  id: string;
  name: string;
  previewUrl?: string;
}

export interface STTOptions {
  language?: string;
  prompt?: string;
}

export interface TTSOptions {
  speed?: number;
  stability?: number;
  similarityBoost?: number;
}
