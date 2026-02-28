<p align="center">
  <img src="apps/desktop/src/assets/jam-logo.png" alt="Jam" width="128" />
</p>

<h1 align="center">Jam</h1>

<p align="center">AI Agent Orchestrator — run a team of AI agents from your desktop with voice control.</p>

<p align="center">
  <a href="https://github.com/SuperInstance/jam/releases/latest">
    <img src="https://img.shields.io/github/v/release/SuperInstance/jam?label=Download&style=flat-square" alt="Release">
  </a>
  <a href="https://github.com/SuperInstance/jam/stargazers">
    <img src="https://img.shields.io/github/stars/SuperInstance/jam?style=flat-square" alt="Stars">
  </a>
  <a href="https://github.com/SuperInstance/jam/network/members">
    <img src="https://img.shields.io/github/forks/SuperInstance/jam?style=flat-square" alt="Forks">
  </a>
  <a href="https://github.com/SuperInstance/jam/issues">
    <img src="https://img.shields.io/github/issues/SuperInstance/jam?style=flat-square" alt="Issues">
  </a>
  <img src="https://img.shields.io/github/license/SuperInstance/jam?style=flat-square" alt="License">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue?style=flat-square" alt="Platform">
  <img src="https://img.shields.io/badge/node-%3E%3D22-green?style=flat-square" alt="Node">
  <img src="https://img.shields.io/badge/typescript-5.9-blue?style=flat-square" alt="TypeScript">
</p>

---

## Table of Contents

- [Preview](#preview)
- [Quick Start](#quick-start)
- [Download](#download)
- [What is Jam?](#what-is-jam)
- [Features](#features)
- [Architecture](#architecture)
- [Configuration](#configuration)
- [Development](#development)
- [Contributing](#contributing)
- [Roadmap](#roadmap)
- [Acknowledgments](#acknowledgments)

---

## Preview

<p align="center">
  <a href="https://youtu.be/sXrvp5j5U6s">
    <img src="https://img.youtube.com/vi/sXrvp5j5U6s/maxresdefault.jpg" alt="Jam Preview" width="600" />
  </a>
</p>

## Quick Start

```bash
git clone https://github.com/SuperInstance/jam.git
cd jam
./scripts/setup.sh
yarn dev
```

The setup script handles everything: Node version, Yarn 4 via Corepack, dependencies, and verification. Just clone and run.

> **Requires**: Node.js >= 22 (the script will install it via nvm/fnm if needed)

## Download

Pre-built binaries — no setup needed:

| Platform | Download |
|----------|----------|
| macOS | [Jam.dmg](https://github.com/SuperInstance/jam/releases/latest/download/Jam.dmg) |
| Windows | [Jam-Setup.exe](https://github.com/SuperInstance/jam/releases/latest/download/Jam-Setup.exe) |
| Linux | [Jam.AppImage](https://github.com/SuperInstance/jam/releases/latest/download/Jam.AppImage) |

> macOS builds are signed and notarized with Apple Developer ID — no Gatekeeper warnings.

## What is Jam?

Jam lets you create, manage, and talk to a team of AI coding agents running on your machine. Each agent gets its own terminal, personality, voice, and workspace.

## Features

### Core Capabilities

- **Multi-agent orchestration** — Run multiple AI agents simultaneously, each in their own PTY
  - Start, stop, and restart agents individually
  - Monitor agent status and resource usage
  - Queue commands when agents are busy

- **Voice control** — Talk to your agents hands-free
  - STT: OpenAI Whisper, ElevenLabs
  - TTS: OpenAI, ElevenLabs (with streaming for lower latency)
  - Voice activity detection and noise filtering

- **Intent classification system** — Commands are intelligently routed
  - Automatic categorization: code, research, system, general
  - Pattern-based matching with confidence scoring
  - Extensible registry for custom intent types

- **Agent runtimes** — Pluggable backend support
  - [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (Anthropic)
  - [OpenCode](https://opencode.ai)
  - [Codex CLI](https://github.com/openai/codex) (OpenAI)
  - [Cursor](https://cursor.com)

- **Living personalities** — Each agent has a SOUL.md that evolves over time
  - Automatic reflection and personality updates
  - Cross-session memory persistence

- **Conversation memory** — Agents remember past conversations
  - Daily JSONL logs for each agent
  - Searchable conversation history
  - Context carried across sessions

- **Dynamic skills** — Agents auto-generate reusable skill files
  - Learned patterns saved to `~/.jam/skills/`
  - Shared skills available to all agents
  - Hot-reload when skills change

- **Team collaboration** — Agents can work together
  - Inter-agent messaging via channels
  - Task assignment and tracking
  - Relationship and trust tracking

### User Interface

- **Chat + Stage views** — Unified chat or grid view showing all agents
- **Terminal integration** — Each agent gets a PTY with xterm.js
- **Notification system** — Task completion notifications
- **Dark theme** — Optimized for long coding sessions

### Technical Features

- **Performance optimizations**
  - React.memo and useCallback for minimal re-renders
  - Zustand store with shallow selectors
  - IPC batching for terminal output
  - Code splitting with lazy loading

- **Error handling**
  - React ErrorBoundaries for graceful failure
  - Structured logging throughout
  - Automatic agent crash recovery

- **Security**
  - Context isolation and sandbox mode
  - API keys encrypted with electron safeStorage
  - Command injection prevention
  - Whitelist-based terminal commands

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Desktop App                             │
│               (Electron + React + Zustand)                   │
├─────────────────────────────────────────────────────────────┤
│  Orchestrator                                               │
│  ├── AgentManager (lifecycle, PTY, execute)                 │
│  ├── VoiceService (STT/TTS pipeline, streaming)             │
│  ├── CommandRouter (intent classification, routing)         │
│  ├── EventBus (cross-cutting events)                        │
│  └── MemoryStore (file-based persistence)                   │
├─────────────────────────────────────────────────────────────┤
│  IPC Layer (Domain-Specific Handlers)                       │
│  ├── agent-handlers    ├── voice-handlers                   │
│  ├── terminal-handlers ├── chat-handlers                    │
│  ├── config-handlers   ├── setup-handlers                   │
│  └── task-handlers     ├── service-handlers                 │
├─────────────────────────────────────────────────────────────┤
│  Agent Runtimes (Strategy Pattern)                          │
│  ├── Claude Code  (JSONL output, claude CLI)                │
│  ├── OpenCode     (Throttled output, opencode CLI)          │
│  ├── Codex CLI    (CLI-arg input, codex CLI)                │
│  └── Cursor       (JSONL output, cursor-agent CLI)          │
├─────────────────────────────────────────────────────────────┤
│  Voice Providers (Registry Pattern)                         │
│  ├── STT: Whisper / ElevenLabs                              │
│  └── TTS: OpenAI / ElevenLabs (streaming support)           │
├─────────────────────────────────────────────────────────────┤
│  Team System                                                │
│  ├── TaskScheduler      ├── SmartTaskAssigner               │
│  ├── SelfImprovement    ├── InboxWatcher                    │
│  └── SoulEvolution      ├── ChannelMessaging                │
└─────────────────────────────────────────────────────────────┘
```

### Packages

| Package | Description |
|---------|-------------|
| `@jam/core` | Domain models, port interfaces, events, logger |
| `@jam/eventbus` | In-process event bus with type-safe emissions |
| `@jam/agent-runtime` | PTY management, agent lifecycle, runtime implementations |
| `@jam/voice` | STT/TTS providers, command parser, voice service |
| `@jam/memory` | File-based agent memory and session persistence |
| `@jam/team` | Task scheduling, soul evolution, team collaboration |
| `@jam/sandbox` | Docker-based agent sandboxing (optional) |

## Configuration

### Prerequisites

- At least one agent runtime CLI installed:
  - [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
  - [OpenCode](https://opencode.ai)
  - [Codex CLI](https://github.com/openai/codex)
  - [Cursor](https://cursor.com)
- API keys for voice providers (optional):
  - OpenAI API key (Whisper STT, OpenAI TTS)
  - ElevenLabs API key (ElevenLabs STT/TTS)

### First Launch

1. Launch Jam
2. Open **Settings** (gear icon in sidebar)
3. Add your API keys for voice providers
4. Create an agent — pick a name, runtime, model, and voice

### Agent Workspace

Each agent gets a directory at `~/.jam/agents/<name>/`:

```
~/.jam/agents/sue/
├── SOUL.md              # Living personality file
├── conversations/       # Daily JSONL conversation logs
│   └── 2026-02-18.jsonl
└── skills/              # Agent-created skill files
    └── react-patterns.md
```

### Shared Skills

Place shared skills in `~/.jam/skills/` to make them available to all agents:

```
~/.jam/skills/
├── git-workflow.md
├── testing-patterns.md
└── api-design.md
```

## Development

### Requirements

- Node.js >= 22 (Vite 7 requires 22.12+)
- Yarn 4 (managed automatically via Corepack)

### Commands

| Command | Description |
|---------|-------------|
| `yarn dev` | Start desktop app in dev mode |
| `yarn build` | Build all packages |
| `yarn typecheck` | Type check all packages |
| `yarn lint` | Run ESLint |
| `yarn test` | Run tests |

### Project Structure

```
apps/
  desktop/
    electron/         # Main process (IPC handlers, orchestrator)
    src/              # Renderer process (React components)
      components/     # Presentational components
      containers/     # Zustand-connected components
      hooks/          # Custom React hooks
      store/          # Zustand slices
      types/          # TypeScript type definitions
      utils/          # Utility functions

packages/
  core/               # Domain models, port interfaces
  eventbus/           # In-process event bus
  agent-runtime/      # PTY management, runtimes
  voice/              # STT/TTS providers
  memory/             # Agent memory persistence
  team/               # Team collaboration features
  sandbox/            # Docker sandboxing
```

### Design Principles

1. **SOLID** — Depend on abstractions (port interfaces in `@jam/core`)
2. **Strategy pattern** — Pluggable runtimes and voice providers
3. **Template method** — BaseAgentRuntime with overrideable hooks
4. **Observer pattern** — EventBus for decoupled event propagation
5. **Registry pattern** — Extensible provider and command handler registries
6. **Container/Component** — React containers wire to Zustand, components stay pure

### Adding Features

See `.claude/commands/` for guides on:
- `/add-runtime <name>` — Adding a new agent runtime
- `/add-voice-provider <name>` — Adding a new STT/TTS provider
- `/add-ipc-handler <name>` — Creating a new IPC handler module

## Contributing

We welcome contributions! Please follow these guidelines:

### Getting Started

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Run tests: `yarn test && yarn typecheck`
5. Submit a pull request

### Commit Convention

We use [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` New features
- `fix:` Bug fixes
- `docs:` Documentation changes
- `refactor:` Code refactoring
- `test:` Adding tests
- `chore:` Maintenance tasks

### Code Style

- TypeScript strict mode
- ESLint + Prettier
- Follow existing patterns in the codebase
- Add JSDoc comments for public APIs

## Roadmap

### v0.5.0 (Current)
- [x] Intent classification system
- [x] Streaming TTS
- [x] React performance optimizations
- [x] Error boundaries
- [x] TypeScript strict mode

### v0.6.0 (Next)
- [ ] Global keyboard shortcuts
- [ ] Command palette (Cmd+K)
- [ ] Conversation search
- [ ] Agent templates

### v0.7.0
- [ ] Frontend test coverage
- [ ] E2E testing with Playwright
- [ ] Accessibility improvements
- [ ] Plugin system

### Future
- [ ] Agent marketplace
- [ ] Cloud sync
- [ ] Team collaboration (multi-user)
- [ ] Mobile companion app

## Acknowledgments

### Built With

- [Electron](https://www.electronjs.org/) - Cross-platform desktop apps
- [React](https://react.dev/) - UI framework
- [Zustand](https://zustand-demo.pmnd.rs/) - State management
- [TypeScript](https://www.typescriptlang.org/) - Type safety
- [Vite](https://vitejs.dev/) - Build tooling
- [xterm.js](https://xtermjs.org/) - Terminal emulation

### Inspired By

- [Claude Code](https://claude.ai/code) - AI coding assistant
- [Cursor](https://cursor.com) - AI-first code editor
- [Windsurf](http://windsurf.ai) - AI IDE

### Special Thanks

- [Anthropic](https://anthropic.com) for Claude
- [OpenAI](https://openai.com) for Whisper and TTS
- [ElevenLabs](https://elevenlabs.io) for high-quality voice synthesis
- The open-source community

---

## AI Assistant Context

For AI coding assistants (Claude, Copilot, etc.), see [CLAUDE.md](./CLAUDE.md) for project context, architecture decisions, and coding conventions.

---

<p align="center">
  <a href="https://github.com/SuperInstance/jam">
    <img src="https://img.shields.io/badge/⭐_Star_on_GitHub-gray?style=for-the-badge" alt="Star on GitHub">
  </a>
</p>

<p align="center">
  Made with ❤️ by the Jam community
</p>
