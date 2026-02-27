# Jam Codebase Improvement Action Plan

**Generated:** 2026-02-27
**Total Issues Found:** 72 across 6 categories

---

## Overview

This plan prioritizes fixes by impact and effort, organized into 4 phases over 4+ weeks.

| Phase | Focus | Issues | Effort |
|-------|-------|--------|--------|
| 1 | Security & Stability | 12 | ~1 week |
| 2 | Performance | 16 | ~1 week |
| 3 | Type Safety | 10 | ~1 week |
| 4 | Architecture & DRY | 34 | ~2 weeks |

---

## Phase 1: Security & Stability (CRITICAL)

### 1.1 Fix Command Injection in setup-handlers.ts

**File:** `apps/desktop/electron/ipc/setup-handlers.ts`
**Lines:** 107-123
**Severity:** CRITICAL
**Effort:** 1 hour

**Current Code:**
```typescript
ipcMain.handle('setup:openTerminal', (_, command: string) => {
  if (process.platform === 'darwin') {
    execFileSync('osascript', [
      '-e', `tell application "Terminal" to do script "${command}"`,  // INJECTION RISK
      '-e', 'tell application "Terminal" to activate',
    ], { timeout: 5000 });
  }
```

**Fix:**
```typescript
// Add at top of file
function escapeAppleScript(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// Add command allowlist
const ALLOWED_TERMINAL_COMMANDS = [
  'claude',
  'opencode',
  'codex',
  'cursor-agent',
  'npm install',
  'yarn',
];

function validateCommand(command: string): boolean {
  const baseCmd = command.split(' ')[0];
  return ALLOWED_TERMINAL_COMMANDS.some(allowed =>
    baseCmd === allowed || command.startsWith(allowed + ' ')
  );
}

ipcMain.handle('setup:openTerminal', (_, command: string) => {
  if (!validateCommand(command)) {
    throw new Error(`Command not allowed: ${command}`);
  }

  const escaped = escapeAppleScript(command);

  if (process.platform === 'darwin') {
    execFileSync('osascript', [
      '-e', `tell application "Terminal" to do script "${escaped}"`,
      '-e', 'tell application "Terminal" to activate',
    ], { timeout: 5000 });
  }
  // ... rest of platforms
});
```

---

### 1.2 Fix stdin Null Pointer Risk

**Files:**
- `packages/agent-runtime/src/runtimes/base-runtime.ts:51-52`
- `packages/agent-runtime/src/runtimes/opencode.ts:87-88`

**Severity:** CRITICAL
**Effort:** 30 minutes

**Current Code:**
```typescript
child.stdin!.write(text);
child.stdin!.end();
```

**Fix (base-runtime.ts):**
```typescript
protected writeInput(child: ChildProcess, _profile: AgentProfile, text: string): void {
  if (!child.stdin) {
    log.warn('stdin not available, skipping input write');
    return;
  }
  child.stdin.write(text);
  child.stdin.end();
}
```

**Fix (opencode.ts):** Remove override if it just duplicates base class, or add same null check.

---

### 1.3 Fix Windows Compatibility - Replace process.env.HOME

**Files:**
- `packages/agent-runtime/src/pty-manager.ts:106`
- `packages/agent-runtime/src/runtimes/base-runtime.ts:60`
- `apps/desktop/electron/ipc/agent-handlers.ts:14, 23`

**Severity:** CRITICAL
**Effort:** 30 minutes

**Step 1:** Create utility function

```typescript
// packages/core/src/utils/path.ts
import { homedir } from 'os';

export function getUserHome(): string {
  return homedir();
}

export function getJamDir(): string {
  return join(homedir(), '.jam');
}

export function getAgentsDir(): string {
  return join(homedir(), '.jam', 'agents');
}
```

**Step 2:** Replace all occurrences:

```typescript
// Before
const home = process.env.HOME || '/';
const agentsDir = join(home, '.jam', 'agents', sanitized);

// After
import { getAgentsDir } from '@jam/core/utils/path';
const agentsDir = join(getAgentsDir(), sanitized);
```

**Files to update:**
1. `packages/agent-runtime/src/pty-manager.ts`
2. `packages/agent-runtime/src/runtimes/base-runtime.ts`
3. `apps/desktop/electron/ipc/agent-handlers.ts`
4. `packages/team/src/soul-manager.ts`
5. Any other files using `process.env.HOME`

---

### 1.4 Fix Unhandled Promise in AgentManager

**File:** `packages/agent-runtime/src/agent-manager.ts:399-417`
**Severity:** HIGH
**Effort:** 30 minutes

**Current Code:**
```typescript
let result;
try {
  result = await runtime.execute(enrichedProfile, text, { ... });
} catch (err) {
  // ...
}
// Bug: result could be undefined here
if (!result.success) { ... }  // CRASH
```

**Fix:**
```typescript
let result: ExecutionResult | undefined;
try {
  result = await runtime.execute(enrichedProfile, text, { ... });
} catch (err) {
  const errMsg = err instanceof Error ? err.message : String(err);
  eventBus.emit(Events.AGENT_OUTPUT, {
    agentId,
    output: { type: 'error', content: errMsg, raw: errMsg },
  });
  return { success: false, error: errMsg };
}

// Now safe to access result
if (!result || !result.success) {
  return { success: false, error: result?.error ?? 'Unknown error' };
}
```

---

### 1.5 Replace Silent Error Catching

**Files:** 10+ locations
**Severity:** HIGH
**Effort:** 2 hours

**Current Pattern:**
```typescript
.catch(() => {});  // Silent failure
```

**Fix Pattern:**
```typescript
// Create a logging helper
import { createLogger } from '@jam/core/logger';
const log = createLogger('module-name');

.catch((err) => {
  log.warn('Operation failed', err);
});
```

**Files to update:**
1. `packages/agent-runtime/src/agent-manager.ts` (lines 447, 452, 532, 537)
2. `apps/desktop/electron/orchestrator.ts` (line 294)
3. `packages/agent-runtime/src/service-registry.ts` (line 203)
4. `packages/agent-runtime/src/runtimes/jsonl-parser.ts` (lines 52, 122)

---

### 1.6 Fix Incorrect Filter Logic in AgentContextBuilder

**File:** `packages/agent-runtime/src/agent-context-builder.ts:116-119`
**Severity:** HIGH
**Effort:** 15 minutes

**Current Code:**
```typescript
let filtered = allEntries.filter(e => !e.hidden);
if (options.before) {
  filtered = allEntries.filter(e => e.timestamp < options.before!);  // BUG: uses allEntries, not filtered
}
```

**Fix:**
```typescript
let filtered = allEntries.filter(e => !e.hidden);
if (options.before) {
  filtered = filtered.filter(e => e.timestamp < options.before);
}
```

---

### 1.7 Add IPC Input Validation

**Files:** All handlers in `apps/desktop/electron/ipc/`
**Severity:** HIGH
**Effort:** 4 hours

**Step 1:** Install zod
```bash
yarn workspace @jam/desktop add zod
```

**Step 2:** Create validation schemas

```typescript
// apps/desktop/electron/ipc/schemas.ts
import { z } from 'zod';

export const AgentProfileSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(50),
  runtime: z.string(),
  model: z.string().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  cwd: z.string().optional(),
});

export const CreateAgentParamsSchema = AgentProfileSchema.partial({ id: true });

export const ExecutionOptionsSchema = z.object({
  timeout: z.number().optional(),
  signal: z.any().optional(),
});
```

**Step 3:** Apply to handlers

```typescript
// agent-handlers.ts
import { CreateAgentParamsSchema } from './schemas';

ipcMain.handle('agents:create', (_, profile) => {
  const validated = CreateAgentParamsSchema.parse(profile);  // Throws if invalid
  return agentManager.create(validated);
});
```

---

## Phase 2: Performance

### 2.1 Fix useIPCSubscriptions Re-subscription Storm

**File:** `apps/desktop/src/hooks/useIPCSubscriptions.ts`
**Severity:** HIGH
**Effort:** 2 hours

**Current Issue:** 22 dependencies cause complete teardown/rebuild of all subscriptions.

**Fix:**
```typescript
import { useRef, useEffect } from 'react';
import { useAppStore } from '../store';

export function useIPCSubscriptions(): void {
  // Use refs to avoid dependency churn
  const storeRef = useRef(useAppStore.getState());

  // Keep ref updated
  useEffect(() => {
    const unsubscribe = useAppStore.subscribe((state) => {
      storeRef.current = state;
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    // Now use storeRef.current.xxx instead of deps
    const { addAgent, removeAgent, updateAgentStatus, ... } = storeRef.current;

    // All subscriptions here, no deps array needed
    const unsubscribers: Array<() => void> = [];

    unsubscribers.push(
      window.jam.agents.onCreated((agent) => {
        addAgent(agent);  // Uses ref, stable
      })
    );

    // ... rest of subscriptions

    return () => {
      unsubscribers.forEach((u) => u());
    };
  }, []);  // Empty deps - stable
}
```

---

### 2.2 Add React.memo to Hot Components

**Files:**
- `apps/desktop/src/components/chat/ChatMessage.tsx`
- `apps/desktop/src/components/agent/AgentCard.tsx`

**Severity:** HIGH
**Effort:** 1 hour

**ChatMessage.tsx Fix:**
```typescript
import { memo, useMemo, useCallback } from 'react';

interface ChatMessageProps {
  message: ChatMessage;
  onDelete?: (id: string) => void;
}

// Move outside component
function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export const ChatMessage = memo<ChatMessageProps>(({ message, onDelete }) => {
  const runtimeLabel = useMemo(() => {
    const labels: Record<string, string> = {
      'claude-code': 'Claude Code',
      'cursor': 'Cursor',
      'opencode': 'OpenCode',
      'codex-cli': 'Codex CLI',
    };
    return labels[message.agentRuntime] ?? message.agentRuntime;
  }, [message.agentRuntime]);

  const handleDelete = useCallback(() => {
    onDelete?.(message.id);
  }, [message.id, onDelete]);

  // ... rest of component
}, (prev, next) => {
  // Custom comparison for performance
  return prev.message.id === next.message.id &&
         prev.message.status === next.message.status &&
         prev.message.content === next.message.content;
});
```

**AgentCard.tsx Fix:**
```typescript
export const AgentCard = memo<AgentCardProps>(({ ... }) => {
  // component body
}, (prev, next) => {
  return prev.name === next.name &&
         prev.visualState === next.visualState &&
         prev.isSelected === next.isSelected &&
         prev.isRunning === next.isRunning;
});
```

---

### 2.3 Add Zustand Immer Middleware

**File:** `apps/desktop/src/store/index.ts`
**Severity:** HIGH
**Effort:** 1 hour

**Step 1:** Install immer
```bash
yarn workspace @jam/desktop add immer
```

**Step 2:** Update store
```typescript
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

// In each slice, replace spread updates with direct mutation:

// Before (agentSlice.ts)
updateAgentStatus: (agentId, status) =>
  set((state) => ({
    agents: {
      ...state.agents,
      [agentId]: { ...state.agents[agentId], status },
    },
  })),

// After
updateAgentStatus: (agentId, status) =>
  set((state) => {
    state.agents[agentId].status = status;  // Direct mutation
  }),
```

---

### 2.4 Throttle VAD Polling

**File:** `apps/desktop/src/hooks/useVoice.ts:190-192`
**Severity:** MEDIUM
**Effort:** 15 minutes

**Current Code:**
```typescript
vadIntervalRef.current = window.setInterval(() => {
  setAudioLevel(getAudioLevel());  // Updates state every 50ms
}, VAD_CHECK_INTERVAL_MS);
```

**Fix:**
```typescript
const lastAudioUpdateRef = useRef(0);

vadIntervalRef.current = window.setInterval(() => {
  const now = Date.now();
  const level = getAudioLevel();

  // Throttle state updates to 100ms
  if (now - lastAudioUpdateRef.current > 100) {
    setAudioLevel(level);
    lastAudioUpdateRef.current = now;
  }
}, VAD_CHECK_INTERVAL_MS);
```

---

### 2.5 Fix Transcript Timeout Leak

**File:** `apps/desktop/src/hooks/useIPCSubscriptions.ts:123`
**Severity:** MEDIUM
**Effort:** 15 minutes

**Current Code:**
```typescript
const unsubTranscription = window.jam.voice.onTranscription(
  ({ text, isFinal }) => {
    setTranscript({ text, isFinal });
    if (isFinal) {
      setTimeout(() => setTranscript(null), 2000);  // Not cleaned up!
    }
  },
);
```

**Fix:**
```typescript
const transcriptTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

const unsubTranscription = window.jam.voice.onTranscription(
  ({ text, isFinal }) => {
    setTranscript({ text, isFinal });
    if (isFinal) {
      if (transcriptTimeoutRef.current) {
        clearTimeout(transcriptTimeoutRef.current);
      }
      transcriptTimeoutRef.current = setTimeout(
        () => setTranscript(null),
        2000
      );
    }
  },
);

// Add cleanup
useEffect(() => {
  return () => {
    if (transcriptTimeoutRef.current) {
      clearTimeout(transcriptTimeoutRef.current);
    }
  };
}, []);
```

---

### 2.6 Code-Split Terminal Component

**File:** `apps/desktop/src/components/terminal/TerminalView.tsx`
**Severity:** MEDIUM
**Effort:** 30 minutes

**Step 1:** Create lazy wrapper
```typescript
// apps/desktop/src/components/terminal/LazyTerminal.tsx
import { lazy, Suspense } from 'react';

const TerminalView = lazy(() => import('./TerminalView'));

interface LazyTerminalProps {
  agentId: string;
}

export function LazyTerminal({ agentId }: LazyTerminalProps) {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-full text-zinc-500">
        Loading terminal...
      </div>
    }>
      <TerminalView agentId={agentId} />
    </Suspense>
  );
}
```

**Step 2:** Update consumers
```typescript
// In AgentTerminalContainer.tsx
import { LazyTerminal } from '../components/terminal/LazyTerminal';

// Replace <TerminalView /> with <LazyTerminal />
```

---

## Phase 3: Type Safety

### 3.1 Define Proper IPC Types

**File:** `apps/desktop/electron/preload.ts`
**Severity:** HIGH
**Effort:** 4 hours

**Step 1:** Create types file
```typescript
// apps/desktop/src/types/ipc.ts
import type { AgentProfile, AgentState } from '@jam/core';

export interface CreateAgentParams {
  name: string;
  runtime: string;
  model?: string;
  color: string;
  cwd?: string;
}

export interface CreateAgentResult {
  success: boolean;
  agentId?: string;
  error?: string;
}

export interface UpdateAgentParams extends Partial<AgentProfile> {
  id: string;
}

export interface IPCAgents {
  list: () => Promise<AgentState[]>;
  create: (profile: CreateAgentParams) => Promise<CreateAgentResult>;
  update: (agentId: string, updates: UpdateAgentParams) => Promise<{ success: boolean }>;
  delete: (agentId: string) => Promise<{ success: boolean }>;
  start: (agentId: string) => Promise<{ success: boolean; error?: string }>;
  stop: (agentId: string) => Promise<void>;
  // ... etc
}

export interface JamAPI {
  agents: IPCAgents;
  voice: IPCVoice;
  chat: IPCChat;
  config: IPCConfig;
  // ... etc
}
```

**Step 2:** Update preload.ts
```typescript
// Replace all Record<string, unknown> with proper types
agents: {
  create: (profile: CreateAgentParams) =>
    ipcRenderer.invoke('agents:create', profile) as Promise<CreateAgentResult>,
  // ...
}
```

**Step 3:** Update global.d.ts
```typescript
import type { JamAPI } from './types/ipc';

declare global {
  interface Window {
    jam: JamAPI;
  }
}
```

---

### 3.2 Add JSON Schema Validation

**Files:** Multiple (16 JSON.parse calls)
**Severity:** HIGH
**Effort:** 3 hours

**Step 1:** Create validation schemas
```typescript
// apps/desktop/src/schemas/index.ts
import { z } from 'zod';

export const AgentMemorySchema = z.object({
  persona: z.string(),
  facts: z.array(z.string()),
  preferences: z.record(z.string()),
  lastUpdated: z.string(),
});

export const ChatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'agent', 'system']),
  agentId: z.string().optional(),
  content: z.string(),
  timestamp: z.number(),
  status: z.enum(['pending', 'streaming', 'complete', 'error']),
});

export const WhisperResponseSchema = z.object({
  text: z.string(),
  language: z.string().optional(),
  segments: z.array(z.object({
    no_speech_prob: z.number(),
  })).optional(),
});
```

**Step 2:** Apply to JSON.parse locations

```typescript
// packages/memory/src/file-memory-store.ts
import { AgentMemorySchema } from '@jam/core/schemas';

async load(agentId: AgentId): Promise<AgentMemory | null> {
  const raw = await readFile(filePath, 'utf-8');
  const parsed = JSON.parse(raw);
  return AgentMemorySchema.parse(parsed);  // Validates and types
}

// packages/voice/src/stt/whisper.ts
import { WhisperResponseSchema } from '../schemas';

const result = WhisperResponseSchema.parse(await response.json());
```

---

### 3.3 Remove Double Casts

**Files:** `useIPCSubscriptions.ts`, `useTeamStats.ts`, `useTasks.ts`, etc.
**Severity:** MEDIUM
**Effort:** 2 hours

**Current Pattern:**
```typescript
setChannels(result as unknown as ChannelEntry[]);  // Bad
```

**Fix:** Ensure types match at the source

```typescript
// In preload.ts, ensure proper return type
channels: {
  list: () => ipcRenderer.invoke('team:channels:list') as Promise<ChannelEntry[]>,
}

// Now in useIPCSubscriptions.ts
window.jam.team.channels.list().then((channels) => {
  setChannels(channels);  // No cast needed
});
```

---

### 3.4 Replace React.FC with Direct Types

**Files:** 40+ components
**Severity:** LOW
**Effort:** 2 hours

**Current:**
```typescript
const MyComponent: React.FC<Props> = ({ value }) => { ... }
```

**Fix:**
```typescript
interface MyComponentProps {
  value: string;
}

function MyComponent({ value }: MyComponentProps) {
  // ...
}
```

---

## Phase 4: Architecture & DRY

### 4.1 Extract TTSOrchestrator from Orchestrator

**Files:**
- `apps/desktop/electron/orchestrator.ts` (extract from)
- `apps/desktop/electron/tts-orchestrator.ts` (new)

**Severity:** MEDIUM
**Effort:** 3 hours

**New File:**
```typescript
// apps/desktop/electron/tts-orchestrator.ts
import type { IVoiceService, IEventBus, IPresentationAdapter } from '@jam/core';
import { createLogger } from '@jam/core';

const log = createLogger('tts-orchestrator');

export interface TTSOrchestratorDeps {
  voiceService: IVoiceService | null;
  eventBus: IEventBus;
  rendererAdapter: IPresentationAdapter;
}

export class TTSOrchestrator {
  private readonly deathPhrases = [
    'All done!', 'Task complete!', 'Finished!', 'Done!',
  ];

  constructor(private deps: TTSOrchestratorDeps) {}

  async speakAck(agentId: string, text: string): Promise<void> {
    // Move speakAck logic here
  }

  async speakProgress(agentId: string, type: string, summary: string): Promise<void> {
    // Move speakProgress logic here
  }

  async speakAgentDeath(agentId: string): Promise<void> {
    // Move death phrase logic here
  }

  private stripMarkdown(text: string): string {
    // Move markdown stripping here
  }
}
```

**Update Orchestrator:**
```typescript
import { TTSOrchestrator } from './tts-orchestrator';

class Orchestrator {
  private ttsOrchestrator: TTSOrchestrator;

  constructor() {
    this.ttsOrchestrator = new TTSOrchestrator({
      voiceService: this.voiceService,
      eventBus: this.eventBus,
      rendererAdapter: this.rendererAdapter,
    });
  }

  // Delegate TTS calls
  async speakAck(agentId: string, text: string): Promise<void> {
    return this.ttsOrchestrator.speakAck(agentId, text);
  }
}
```

---

### 4.2 Create Agent Info Payload Builder

**Files:**
- `apps/desktop/electron/ipc/payload-builder.ts` (new)
- Multiple handler files (update)

**Severity:** MEDIUM
**Effort:** 1 hour

**New File:**
```typescript
// apps/desktop/electron/ipc/payload-builder.ts
import type { AgentProfile, AgentState } from '@jam/core';

interface AgentInfoPayload {
  agentId: string;
  agentName: string;
  agentRuntime: string;
  agentColor: string;
  [key: string]: unknown;
}

export function buildAgentPayload(
  agent: AgentState | null,
  extras?: Record<string, unknown>
): AgentInfoPayload {
  return {
    agentId: agent?.profile.id ?? '',
    agentName: agent?.profile.name ?? 'Agent',
    agentRuntime: agent?.profile.runtime ?? '',
    agentColor: agent?.profile.color ?? '#6b7280',
    ...extras,
  };
}

export function buildAgentPayloadFromId(
  agentId: string,
  manager: AgentManager,
  extras?: Record<string, unknown>
): AgentInfoPayload {
  const agent = manager.getAgentState(agentId);
  return buildAgentPayload(agent, extras);
}
```

**Usage:**
```typescript
// voice-handlers.ts
import { buildAgentPayloadFromId } from './payload-builder';

const payload = buildAgentPayloadFromId(targetId, agentManager, {
  acknowledged: true,
});
win.webContents.send('chat:agentAcknowledged', payload);
```

---

### 4.3 Create Zustand Record Helper

**Files:**
- `apps/desktop/src/store/helpers.ts` (new)
- All slices (update)

**Severity:** MEDIUM
**Effort:** 2 hours

**New File:**
```typescript
// apps/desktop/src/store/helpers.ts
import type { StateCreator } from 'zustand';

export interface RecordState<T> {
  [id: string]: T;
}

export interface RecordActions<T extends { id: string }> {
  add: (item: T) => void;
  update: (id: string, updates: Partial<T>) => void;
  remove: (id: string) => void;
  get: (id: string) => T | undefined;
  getAll: () => T[];
}

export function createRecordActions<T extends { id: string }>(
  set: Parameters<StateCreator<any>>[1],
  get: () => { records: RecordState<T> },
  recordKey: string = 'records'
): RecordActions<T> {
  return {
    add: (item) =>
      set((state) => ({
        [recordKey]: { ...state[recordKey], [item.id]: item },
      })),

    update: (id, updates) =>
      set((state) => ({
        [recordKey]: {
          ...state[recordKey],
          [id]: { ...state[recordKey][id], ...updates },
        },
      })),

    remove: (id) =>
      set((state) => {
        const { [id]: _, ...rest } = state[recordKey];
        return { [recordKey]: rest };
      }),

    get: (id) => get()[recordKey]?.[id],

    getAll: () => Object.values(get()[recordKey]),
  };
}
```

**Usage in Slice:**
```typescript
// agentSlice.ts
import { createRecordActions, RecordActions } from './helpers';

interface AgentSlice extends RecordActions<AgentState> {
  agents: RecordState<AgentState>;
  // ... other state
}

export const createAgentSlice: StateCreator<AgentSlice> = (set, get) => {
  const recordActions = createRecordActions(set, () => ({ agents: get().agents }), 'agents');

  return {
    agents: {},
    ...recordActions,
    // Custom actions
    updateAgentStatus: (id, status) => recordActions.update(id, { status }),
  };
};
```

---

### 4.4 Move Runtime formatInput to Base Class

**Files:**
- `packages/agent-runtime/src/runtimes/base-runtime.ts`
- `packages/agent-runtime/src/runtimes/claude-code.ts`
- `packages/agent-runtime/src/runtimes/cursor.ts`
- `packages/agent-runtime/src/runtimes/codex-cli.ts`

**Severity:** MEDIUM
**Effort:** 30 minutes

**Add to BaseAgentRuntime:**
```typescript
// base-runtime.ts
formatInput(text: string, context?: InputContext): string {
  let input = text;
  if (context?.sharedContext) {
    input = `[Context from other agents: ${context.sharedContext}]\n\n${input}`;
  }
  return input;
}
```

**Remove from subclasses:**
```typescript
// claude-code.ts - DELETE this method
formatInput(text: string, context?: InputContext): string {
  let input = text;
  if (context?.sharedContext) {
    input = `[Context from other agents: ${context.sharedContext}]\n\n${input}`;
  }
  return input;
}
```

---

### 4.5 Create Storage Port Interfaces

**File:** `packages/core/src/ports/storage.ts` (new)
**Severity:** MEDIUM
**Effort:** 2 hours

**New File:**
```typescript
// packages/core/src/ports/storage.ts
import type { AgentId, ConversationEntry, SkillDefinition, AgentProfile } from '../models';

export interface IConversationStorage {
  loadRecent(cwd: string, limit: number): Promise<ConversationEntry[]>;
  loadPaginated(cwd: string, options: { before?: string; limit: number }): Promise<{
    entries: ConversationEntry[];
    hasMore: boolean;
  }>;
  record(cwd: string, entry: ConversationEntry): Promise<void>;
}

export interface ISkillStorage {
  loadAll(dir: string): Promise<SkillDefinition[]>;
  save(dir: string, name: string, content: string): Promise<void>;
}

export interface ISoulStorage {
  read(cwd: string): Promise<string>;
  initialize(cwd: string, profile: AgentProfile): Promise<void>;
}

export interface IStoragePorts {
  conversations: IConversationStorage;
  skills: ISkillStorage;
  soul: ISoulStorage;
}
```

---

## Testing Checklist

After implementing fixes, verify:

### Security
- [ ] Command injection tests pass
- [ ] Windows path tests pass
- [ ] IPC validation tests pass

### Performance
- [ ] React DevTools shows no unnecessary re-renders
- [ ] Memory usage stable over 1-hour session
- [ ] No event listener leaks in DevTools

### Type Safety
- [ ] `yarn typecheck` passes with 0 errors
- [ ] No `any` types in production code
- [ ] IPC types match between main/renderer

### Architecture
- [ ] All tests pass
- [ ] Bundle size not increased
- [ ] No circular dependencies

---

## Progress Tracking

Use this checklist to track implementation:

```markdown
## Phase 1: Security & Stability
- [ ] 1.1 Command injection fix
- [ ] 1.2 stdin null check
- [ ] 1.3 Windows compatibility
- [ ] 1.4 Unhandled promise fix
- [ ] 1.5 Silent error logging
- [ ] 1.6 Filter logic fix
- [ ] 1.7 IPC validation

## Phase 2: Performance
- [ ] 2.1 useIPCSubscriptions refactor
- [ ] 2.2 React.memo additions
- [ ] 2.3 Zustand Immer middleware
- [ ] 2.4 VAD throttling
- [ ] 2.5 Transcript timeout fix
- [ ] 2.6 Terminal code-splitting

## Phase 3: Type Safety
- [ ] 3.1 IPC types definition
- [ ] 3.2 JSON schema validation
- [ ] 3.3 Double cast removal
- [ ] 3.4 React.FC replacement

## Phase 4: Architecture
- [ ] 4.1 TTSOrchestrator extraction
- [ ] 4.2 Payload builder creation
- [ ] 4.3 Zustand record helper
- [ ] 4.4 formatInput consolidation
- [ ] 4.5 Storage port interfaces
```

---

## Risk Assessment

| Change | Risk | Mitigation |
|--------|------|------------|
| Command injection fix | Medium | Test all terminal scenarios |
| useIPCSubscriptions refactor | High | Thorough testing, staged rollout |
| Zustand Immer | Medium | Verify all slices work |
| IPC type changes | Medium | TypeScript will catch mismatches |

---

## Estimated Total Effort

| Phase | Hours |
|-------|-------|
| Phase 1 | ~8 hours |
| Phase 2 | ~6 hours |
| Phase 3 | ~11 hours |
| Phase 4 | ~12 hours |
| **Total** | **~37 hours** |

---

*This plan should be reviewed with the team before implementation. Priorities may shift based on user feedback and business needs.*
