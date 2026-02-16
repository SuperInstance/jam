import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { EventBus } from '@jam/eventbus';
import {
  PtyManager,
  AgentManager,
  RuntimeRegistry,
  ClaudeCodeRuntime,
  OpenCodeRuntime,
} from '@jam/agent-runtime';
import {
  VoiceService,
  WhisperSTTProvider,
  ElevenLabsSTTProvider,
  ElevenLabsTTSProvider,
  OpenAITTSProvider,
} from '@jam/voice';
import type { ISTTProvider, ITTSProvider } from '@jam/core';
import { createLogger } from '@jam/core';
import { FileMemoryStore } from '@jam/memory';
import { AppStore } from './storage/store';
import { loadConfig, type JamConfig, type STTProviderType, type TTSProviderType } from './config';

const log = createLogger('Orchestrator');

export class Orchestrator {
  readonly eventBus: EventBus;
  readonly ptyManager: PtyManager;
  readonly runtimeRegistry: RuntimeRegistry;
  readonly agentManager: AgentManager;
  readonly memoryStore: FileMemoryStore;
  readonly appStore: AppStore;
  readonly config: JamConfig;
  voiceService: VoiceService | null = null;

  private mainWindow: BrowserWindow | null = null;

  constructor() {
    this.config = loadConfig();
    this.eventBus = new EventBus();
    this.ptyManager = new PtyManager();
    this.runtimeRegistry = new RuntimeRegistry();
    this.appStore = new AppStore();

    // Register runtimes
    this.runtimeRegistry.register(new ClaudeCodeRuntime());
    this.runtimeRegistry.register(new OpenCodeRuntime());

    // Create agent manager
    this.agentManager = new AgentManager(
      this.ptyManager,
      this.runtimeRegistry,
      this.eventBus,
      this.appStore,
    );

    // Create memory store
    const agentsDir = join(app.getPath('userData'), 'agents');
    this.memoryStore = new FileMemoryStore(agentsDir);
  }

  setMainWindow(win: BrowserWindow): void {
    this.mainWindow = win;

    // Forward events to renderer
    this.eventBus.on('agent:statusChanged', (data) => {
      this.mainWindow?.webContents.send('agents:statusChange', data);
    });

    this.eventBus.on('agent:created', (data) => {
      this.mainWindow?.webContents.send('agents:created', data);
      this.syncAgentNames();
    });

    this.eventBus.on('agent:deleted', (data) => {
      this.mainWindow?.webContents.send('agents:deleted', data);
      this.syncAgentNames();
    });

    this.eventBus.on('agent:visualStateChanged', (data) => {
      this.mainWindow?.webContents.send('agents:visualStateChange', data);
    });

    this.eventBus.on('agent:output', (data: { agentId: string; data: string }) => {
      this.mainWindow?.webContents.send('terminal:data', {
        agentId: data.agentId,
        output: data.data,
      });
    });

    this.eventBus.on('voice:transcription', (data) => {
      this.mainWindow?.webContents.send('voice:transcription', data);
    });

    this.eventBus.on('voice:stateChanged', (data) => {
      this.mainWindow?.webContents.send('voice:stateChanged', data);
    });

    // TTS: when AgentManager detects a complete response, synthesize and send audio
    this.eventBus.on('agent:responseComplete', (data: { agentId: string; text: string }) => {
      this.handleResponseComplete(data.agentId, data.text);
    });
  }

  initVoice(): void {
    const sttProvider = this.createSTTProvider(this.config.sttProvider);
    const ttsProvider = this.createTTSProvider(this.config.ttsProvider);

    if (!sttProvider || !ttsProvider) {
      log.warn('Voice not initialized: missing API keys for configured providers');
      return;
    }

    const audioCacheDir = join(app.getPath('userData'), 'audio-cache', 'tts');

    this.voiceService = new VoiceService({
      sttProvider,
      ttsProvider,
      eventBus: this.eventBus,
      audioCacheDir,
    });

    log.info(`Voice initialized: STT=${this.config.sttProvider}, TTS=${this.config.ttsProvider}`);
    this.syncAgentNames();
  }

  private createSTTProvider(type: STTProviderType): ISTTProvider | null {
    const key = this.appStore.getApiKey(type);
    if (!key) return null;

    const model = this.config.sttModel;
    switch (type) {
      case 'openai':
        return new WhisperSTTProvider(key, model);
      case 'elevenlabs':
        return new ElevenLabsSTTProvider(key, model);
    }
  }

  private createTTSProvider(type: TTSProviderType): ITTSProvider | null {
    const key = this.appStore.getApiKey(type);
    if (!key) return null;

    switch (type) {
      case 'openai':
        return new OpenAITTSProvider(key);
      case 'elevenlabs':
        return new ElevenLabsTTSProvider(key);
    }
  }

  syncAgentNames(): void {
    if (!this.voiceService) return;

    const agents = this.agentManager.list().map((a) => ({
      id: a.profile.id,
      name: a.profile.name,
    }));
    this.voiceService.updateAgentNames(agents);
  }

  /** Synthesize TTS audio from a completed agent response and send to renderer */
  private async handleResponseComplete(agentId: string, responseText: string): Promise<void> {
    if (!this.voiceService) return;

    const agent = this.agentManager.get(agentId);
    if (!agent) return;

    let text = responseText;

    // Skip trivial output
    if (!text || text.length < 10) {
      log.debug(`Skipping TTS: output too short (${text.length} chars)`, undefined, agentId);
      return;
    }

    // Truncate for TTS (avoid reading huge code blocks aloud)
    if (text.length > 1000) text = text.slice(0, 1000) + '...';

    log.debug(`TTS text: "${text.slice(0, 100)}..."`, undefined, agentId);

    try {
      // Use agent's voice, falling back to global default from config
      const voiceId = (agent.profile.voice.ttsVoiceId && agent.profile.voice.ttsVoiceId !== 'default')
        ? agent.profile.voice.ttsVoiceId
        : this.config.ttsVoice;

      log.info(`Synthesizing TTS (${text.length} chars, voice=${voiceId})`, undefined, agentId);
      const audioPath = await this.voiceService.synthesize(text, voiceId, agentId);

      // Read audio file and send as base64 data URL to renderer
      const audioBuffer = await readFile(audioPath);
      const base64 = audioBuffer.toString('base64');
      this.mainWindow?.webContents.send('voice:ttsAudio', {
        agentId,
        audioData: `data:audio/mpeg;base64,${base64}`,
      });
      log.info('TTS audio sent to renderer', undefined, agentId);
    } catch (error) {
      log.error(`TTS synthesis failed: ${String(error)}`, undefined, agentId);
    }
  }

  async startAutoStartAgents(): Promise<void> {
    const agents = this.agentManager.list();
    for (const agent of agents) {
      if (agent.profile.autoStart) {
        log.info(`Auto-starting agent: ${agent.profile.name}`, undefined, agent.profile.id);
        await this.agentManager.start(agent.profile.id);
      }
    }
  }

  shutdown(): void {
    this.agentManager.stopHealthCheck();
    this.agentManager.stopAll();
    this.ptyManager.killAll();
    this.eventBus.removeAllListeners();
  }
}
