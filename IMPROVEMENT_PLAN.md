# JAM Improvement Plan

Generated from research comparing to SuperInstance/jam fork and similar AI orchestrator systems.

## Research Summary

### From SuperInstance/jam Fork
- Agent runtimes: Claude Code, OpenCode, Codex CLI, Cursor
- Living personalities with SOUL.md files
- Dynamic skills auto-generation from ~/.jam/skills/
- EventBus for cross-cutting events
- MemoryStore for file-based persistence

### From Industry Research (2025-2026)

**AWS Multi-Agent Orchestrator Patterns:**
- Intent classification before agent routing
- Semantic routing based on query understanding
- Manager agent pattern for complex multi-step tasks

**OpenAI Agent Building Best Practices:**
- Tool categorization: Data Tools, Action Tools, Orchestration Tools
- Streaming responses for better UX
- Fallback to simpler models when appropriate

**Electron + React Patterns:**
- Context isolation with preload scripts
- Code splitting for performance
- Error boundaries for resilience

**Multi-Agent Voice Control:**
- Streaming TTS for lower latency
- Local model fallbacks for reliability
- VAD optimization for natural conversation

---

## Priority 1: Code Quality & Type Safety

### 1.1 Apply Zustand Record Helper to Remaining Slices
- [x] taskSlice.ts - DONE
- [ ] statsSlice.ts - Use `createRecordActionsById`
- [ ] relationshipSlice.ts - Use `createRecordActions`
- [ ] soulSlice.ts - Use `createRecordActionsById`
- [ ] channelSlice.ts - Use `createRecordActionsById`

### 1.2 Fix TypeScript Type Errors
- [ ] Resolve IPC type mismatches between preload and src
- [ ] Add proper type exports from shared types
- [ ] Remove `as unknown as Type` casts where possible

### 1.3 Add Error Boundaries
- [ ] Create ErrorBoundary component for React
- [ ] Wrap major sections (Chat, AgentPanel, Terminal)
- [ ] Add error logging to main process

---

## Priority 2: Architecture Improvements

### 2.1 Intent Classification for Agent Routing
- [ ] Add intent classifier to CommandRouter
- [ ] Route commands to best-suited agent based on:
  - Query type (code, research, system)
  - Agent capabilities
  - Current workload
- [ ] Fallback to default agent if classification fails

### 2.2 Streaming TTS Responses
- [ ] Implement chunked TTS streaming
- [ ] Start playback before full response received
- [ ] Queue management for multiple TTS chunks

### 2.3 Manager Agent Pattern
- [ ] Create supervisor agent for complex tasks
- [ ] Delegate subtasks to specialized agents
- [ ] Aggregate and summarize results

---

## Priority 3: Performance

### 3.1 Code Splitting
- [x] Terminal component - DONE
- [ ] Settings modal
- [ ] Agent creation wizard
- [ ] Stats/Analytics dashboard

### 3.2 React Optimization
- [ ] Add useMemo for expensive computations
- [ ] Virtualize long message lists
- [ ] Debounce store updates

### 3.3 Memory Management
- [ ] Implement message pagination with virtualization
- [ ] Clear old terminal buffers
- [ ] Limit scrollback history

---

## Priority 4: Features from Research

### 4.1 Dynamic Skills Loading
- [ ] Scan ~/.jam/skills/ for skill files
- [ ] Auto-load skills into agent context
- [ ] Hot-reload when skills change

### 4.2 Agent Soul/Personality System
- [ ] Implement SOUL.md loading
- [ ] Track personality evolution
- [ ] Store reflection history

### 4.3 Team Communication
- [ ] Inter-agent messaging
- [ ] Channel-based communication
- [ ] Task handoff protocols

---

## Priority 5: Security & Reliability

### 5.1 Input Validation
- [ ] Validate all IPC inputs
- [ ] Sanitize user commands
- [ ] Rate limit command execution

### 5.2 Error Recovery
- [ ] Auto-restart crashed agents
- [ ] Save/restore conversation state
- [ ] Graceful degradation when services fail

### 5.3 Logging & Observability
- [x] Add structured logging - DONE
- [ ] Add performance metrics
- [ ] Add usage analytics (opt-in)

---

## Implementation Order

1. **Apply Zustand helper** - Quick wins, reduces boilerplate
2. **Fix type errors** - Improves code quality
3. **Add error boundaries** - Better UX on errors
4. **Streaming TTS** - Noticeable UX improvement
5. **Intent classification** - Smarter agent routing
6. **Code splitting** - Performance optimization
7. **Dynamic skills** - Feature enhancement
8. **Soul system** - Personality depth

---

## Files to Modify

### Store Slices
- `src/store/statsSlice.ts`
- `src/store/relationshipSlice.ts`
- `src/store/soulSlice.ts`
- `src/store/channelSlice.ts`

### Components
- `src/components/ErrorBoundary.tsx` (new)
- `src/components/chat/ChatWindow.tsx`
- `src/components/agents/AgentPanel.tsx`

### Electron
- `electron/command-router.ts`
- `electron/orchestrator.ts`
- `electron/ipc/chat-handlers.ts`

---

## Notes

- No API keys should ever be committed
- All changes should pass typecheck
- Test manually before pushing
- Push incrementally with clear commit messages
