# Developer Onboarding Guide

Welcome to the Jam codebase! This guide will help you understand the architecture, recent improvements, and how to contribute effectively.

## Quick Navigation

- [Architecture Overview](#architecture-overview)
- [Recent Improvements (Feb 2026)](#recent-improvements-feb-2026)
- [Key Files to Understand](#key-files-to-understand)
- [Development Workflow](#development-workflow)
- [Common Tasks](#common-tasks)
- [Known Issues & Future Work](#known-issues--future-work)

---

## Architecture Overview

Jam is a **Yarn 4 monorepo** with the following structure:

```
jam/
├── apps/desktop/          # Electron + React desktop application
│   ├── electron/          # Main process (Node.js)
│   │   ├── main.ts        # App entry point
│   │   ├── orchestrator.ts # Central service composition
│   │   ├── command-router.ts # Voice/text command routing
│   │   └── ipc/           # Domain-specific IPC handlers
│   └── src/               # Renderer process (React)
│       ├── components/    # Pure presentational components
│       ├── containers/    # Zustand-connected components
│       ├── hooks/         # Custom React hooks
│       └── store/         # Zustand state slices
│
├── packages/
│   ├── core/              # Domain models, port interfaces
│   ├── eventbus/          # In-process event bus
│   ├── agent-runtime/     # PTY management, agent runtimes
│   ├── voice/             # STT/TTS providers, command parsing
│   ├── memory/            # Agent memory persistence
│   ├── team/              # Task scheduling, soul evolution
│   └── sandbox/           # Docker sandboxing (optional)
│
└── docs/                  # Documentation (you are here)
```

### Design Patterns Used

| Pattern | Location | Purpose |
|---------|----------|---------|
| **Template Method** | `BaseAgentRuntime` | Shared execute() lifecycle, subclasses override hooks |
| **Strategy** | `OutputStrategy` | Pluggable stdout processing (JSONL vs throttled) |
| **Registry** | `CommandRouter`, providers | Extensible command/provider registration |
| **Observer** | `EventBus` | Cross-cutting event propagation |
| **Dependency Injection** | `Orchestrator` | All services wired in constructor |

---

## Recent Improvements (Feb 2026)

A comprehensive codebase audit was performed with the following improvements:

### Bug Fixes

| Issue | File | Fix |
|-------|------|-----|
| Memory leak in log transport | `main.ts:83-93` | Added `logTransportRegistered` guard flag to prevent duplicate listeners during HMR |
| Unhandled promise rejection | `main.ts:294-296` | Added `.then().catch()` chain for `startAutoStartAgents()` |
| Missing error handling | `useIPCSubscriptions.ts:57-61` | Added catch handler for agent list loading failures |

### Documentation Added (1,880+ lines)

Comprehensive JSDoc documentation was added to all core modules:

- **`orchestrator.ts`** - Service composition, lifecycle management, team services
- **`command-router.ts`** - Handler registry, agent resolution, intent routing
- **`base-runtime.ts`** - Template Method pattern, execution lifecycle
- **`output-strategy.ts`** - Strategy pattern for stdout processing
- **`jsonl-parser.ts`** - JSONL parsing utilities
- **`voice-service.ts`** - STT/TTS coordination, caching
- **`command-parser.ts`** - Agent name extraction strategies
- **`team-executor.ts`** - Serialized queue execution
- **`soul-manager.ts`** - Soul evolution and persistence
- **`self-improvement-engine.ts`** - Reflection triggers
- **IPC handlers** - Terminal, Chat, Voice with flow documentation

### Security Improvements

The following security measures are in place:
- API keys encrypted with `electron.safeStorage`
- Command injection prevention via `execFileSync` with argument arrays
- Context isolation and sandbox mode enabled
- Whitelist-based terminal commands
- Input validation across IPC handlers

---

## Key Files to Understand

### Essential Reading (in order)

1. **`apps/desktop/electron/main.ts`** (~350 lines)
   - App entry point
   - Window creation and lifecycle
   - IPC handler registration
   - Graceful shutdown handling

2. **`apps/desktop/electron/orchestrator.ts`** (~1100 lines)
   - Central service composition
   - Dependency injection
   - Event forwarding to renderer
   - All major subsystems created here

3. **`apps/desktop/electron/command-router.ts`** (~300 lines)
   - Unified voice/text command routing
   - Handler registry pattern
   - Agent resolution fallback chain

4. **`packages/agent-runtime/src/runtimes/base-runtime.ts`** (~250 lines)
   - Template Method pattern
   - Shared execution lifecycle
   - Hooks for runtime customization

5. **`apps/desktop/src/hooks/useIPCSubscriptions.ts`** (~300 lines)
   - All IPC event subscriptions
   - Maps events to Zustand store actions

### IPC Handler Pattern

Each IPC domain has its own handler file in `electron/ipc/`:

```typescript
// Pattern: Narrow dependencies interface
export interface VoiceHandlerDeps {
  getVoiceService: () => VoiceService | null;
  agentManager: AgentManager;
  config: JamConfig;
  speakToRenderer: (agentId: string, message: string) => void;
}

export function registerVoiceHandlers(
  deps: VoiceHandlerDeps,
  router: CommandRouter,
  getWindow: () => BrowserWindow | null,
): void {
  // Register handlers using deps (never pass full orchestrator)
}
```

---

## Development Workflow

### Getting Started

```bash
# Clone and setup
git clone https://github.com/SuperInstance/jam.git
cd jam
./scripts/setup.sh

# Start development
yarn dev
```

### Common Commands

| Command | Description |
|---------|-------------|
| `yarn dev` | Start desktop app with hot reload |
| `yarn build` | Build all packages |
| `yarn typecheck` | Type check all packages |
| `yarn lint` | Run ESLint |
| `yarn test` | Run tests |

### Debugging Tips

1. **Main process logs**: Check the terminal where `yarn dev` is running
2. **Renderer logs**: Open DevTools with `Cmd+Option+I` (macOS) or `Ctrl+Shift+I` (Windows/Linux)
3. **IPC communication**: Add `log.debug()` calls in IPC handlers
4. **State inspection**: Use Zustand devtools in renderer

---

## Common Tasks

### Adding a New Agent Runtime

1. Create file in `packages/agent-runtime/src/runtimes/`
2. Extend `BaseAgentRuntime` and implement abstract methods
3. Choose output strategy: `JsonlOutputStrategy` or `ThrottledOutputStrategy`
4. Export from `packages/agent-runtime/src/index.ts`
5. Register in `Orchestrator` constructor

See `.claude/commands/add-runtime.md` for detailed guide.

### Adding a New IPC Handler

1. Create `electron/ipc/<domain>-handlers.ts`
2. Define `XxxHandlerDeps` interface (narrow dependencies only)
3. Export `registerXxxHandlers(deps: XxxHandlerDeps, ...)` function
4. Register in `main.ts` by destructuring from orchestrator

### Adding a New Voice Provider

1. Implement `ISTTProvider` or `ITTSProvider` interface
2. Add to factory map in `Orchestrator`
3. Add to catalogs in `src/constants/provider-catalog.ts`

---

## Known Issues & Future Work

### Performance Optimizations (Identified but not implemented)

1. **React re-renders**: Use `React.memo` on `AgentStageContainer` items
2. **Agent slice updates**: Consider using Immer for nested Zustand updates
3. **PTY scrollback**: Implement circular buffer instead of array splice
4. **TTS file loading**: Move to worker thread to prevent UI jank
5. **Route code splitting**: Lazy load view components

### Security Recommendations

1. Add config value validation in `config-handlers.ts`
2. Strengthen AppleScript escaping in `setup-handlers.ts`
3. Add task input validation in `task-handlers.ts`
4. Implement secret ID validation in `store.ts`
5. Add audio chunk size limits in `voice-handlers.ts`

### Future Features

See [README.md](../README.md#roadmap) for the full roadmap.

---

## Code Conventions

### TypeScript

- Strict mode enabled
- Prefer interfaces over types for public APIs
- Use `type` for unions, intersections, and utility types
- Add JSDoc for all public functions and classes

### React

- Container/Component pattern: containers connect to Zustand, components stay pure
- Use `useAppStore.getState()` in callbacks to avoid re-subscription loops
- Memoize callbacks with `useCallback` when passed to children
- Use `useShallow` for multi-property selectors

### IPC

- Use `ipcMain.handle` for request/response
- Use `ipcMain.on` for fire-and-forget
- Validate all inputs from renderer
- Never pass full orchestrator to handlers

### Error Handling

- Always add `.catch()` to promises that might reject
- Use ErrorBoundary for React component failures
- Log errors with context using `createLogger`

---

## Questions?

- Check [CLAUDE.md](../CLAUDE.md) for AI assistant context
- Open an issue on GitHub for bugs or feature requests
- Join discussions in the repository

---

*Last updated: February 2026*
