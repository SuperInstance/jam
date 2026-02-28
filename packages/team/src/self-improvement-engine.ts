/**
 * @fileoverview SelfImprovementEngine - Agent self-reflection and autonomous improvement.
 *
 * The SelfImprovementEngine enables agents to:
 * - Reflect on their work patterns and conversation history
 * - Evolve their soul/persona over time
 * - Identify proactive tasks they should undertake
 * - Adjust traits based on evidence from their work
 *
 * Design Patterns:
 * - Dependency Injection: TeamExecutor, conversation loader, and workspace scanner are injected
 * - Prompt Engineering: buildReflectionPrompt() constructs a detailed LLM prompt
 * - Result Parsing: LLM JSON output is parsed into structured reflections
 *
 * The reflection process:
 * 1. Gather context (stats, tasks, conversations, soul, workspace)
 * 2. Build a prompt describing the agent's recent work
 * 3. Execute the reflection via TeamExecutor
 * 4. Parse the LLM response (role, learnings, trait adjustments, goals, tasks)
 * 5. Apply the results (soul evolution + proactive task creation)
 *
 * @module team/self-improvement-engine
 */

import type { ITaskStore, IStatsStore, IEventBus, AgentStats, Task } from '@jam/core';
import { Events, createLogger } from '@jam/core';
import type { SoulManager } from './soul-manager.js';
import type { ITeamExecutor } from './team-executor.js';

const log = createLogger('SelfImprovement');

/**
 * Minimal conversation entry for reflection.
 *
 * This interface avoids coupling to @jam/agent-runtime by defining
 * a minimal conversation structure.
 *
 * @interface
 */
export interface ReflectionConversation {
  /** ISO timestamp of the message */
  timestamp: string;

  /** Whether the message is from the user or agent */
  role: 'user' | 'agent';

  /** The message content */
  content: string;
}

/**
 * Callback to load recent conversations for an agent.
 *
 * @callback ConversationLoader
 * @param agentId - The agent ID to load conversations for
 * @param limit - Maximum number of conversations to return
 * @returns Promise resolving to the conversation history
 */
export type ConversationLoader = (agentId: string, limit: number) => Promise<ReflectionConversation[]>;

/**
 * Summary of an agent's workspace directory.
 *
 * @interface
 */
export interface WorkspaceSummary {
  /** Top-level files and directories */
  entries: Array<{ name: string; type: 'file' | 'dir' }>;

  /** Services found in .services.json files */
  services: Array<{ name: string; port?: number; alive: boolean }>;

  /** Notable files content (READMEs, status docs, etc.) */
  notableFiles: Array<{ name: string; content: string }>;
}

/**
 * Callback to scan an agent's workspace for reflection context.
 *
 * @callback WorkspaceScanner
 * @param agentId - The agent ID to scan the workspace for
 * @returns Promise resolving to the workspace summary, or null if unavailable
 */
export type WorkspaceScanner = (agentId: string) => Promise<WorkspaceSummary | null>;

/**
 * Context gathered for agent reflection.
 *
 * @interface
 */
export interface ReflectionContext {
  /** Agent performance statistics */
  stats: AgentStats | null;

  /** Recent tasks (sorted by recency, limited) */
  recentTasks: Task[];

  /** Recent conversation history */
  recentConversations: ReflectionConversation[];

  /** The agent's current soul structure */
  soul: Awaited<ReturnType<SoulManager['load']>>;

  /** Workspace directory summary */
  workspace: WorkspaceSummary | null;

  /** All proactive tasks ever created for this agent (any status) */
  pastProactiveTasks: Task[];
}

/**
 * Result of an agent's reflection.
 *
 * @interface
 */
export interface ReflectionResult {
  /** Updated role identity based on work patterns */
  role: string;

  /** New learnings extracted from recent work */
  newLearnings: string[];

  /** Trait adjustments (delta values, clamped to [-1, 1]) */
  traitAdjustments: Record<string, number>;

  /** New goals based on observed patterns */
  newGoals: string[];

  /** Proactive tasks the agent should undertake */
  proactiveTasks: Array<{ title: string; description: string }>;
}

/**
 * Gathers metrics/context for an agent and triggers self-reflection.
 *
 * When a TeamExecutor is provided, reflection is fully self-contained —
 * the engine resolves the model tier, executes the LLM call, parses the
 * result, and applies it (soul evolution + proactive task creation).
 *
 * @class
 *
 * @example
 * ```typescript
 * const engine = new SelfImprovementEngine(taskStore, statsStore, soulManager, eventBus);
 * engine.setTeamExecutor(teamExecutor);
 * engine.setConversationLoader(loadConversations);
 * engine.setWorkspaceScanner(scanWorkspace);
 *
 * const result = await engine.triggerReflection('agent-1');
 * console.log(result.newLearnings); // ["Users prefer shorter responses", ...]
 * ```
 */
export class SelfImprovementEngine {
  /** Team executor for LLM calls (injected after construction) */
  private teamExecutor: ITeamExecutor | null = null;

  /** Conversation loader (injected) */
  private conversationLoader: ConversationLoader | null = null;

  /** Workspace scanner (injected) */
  private workspaceScanner: WorkspaceScanner | null = null;

  /**
   * Creates a new SelfImprovementEngine.
   *
   * @param taskStore - Task store for loading agent tasks
   * @param statsStore - Stats store for loading agent statistics
   * @param soulManager - Soul manager for loading/saving souls
   * @param eventBus - Event bus for emitting events
   */
  constructor(
    private readonly taskStore: ITaskStore,
    private readonly statsStore: IStatsStore,
    private readonly soulManager: SoulManager,
    private readonly eventBus: IEventBus,
  ) {}

  /**
   * Injects the team executor after construction.
   *
   * This avoids circular dependencies in the orchestrator.
   *
   * @param executor - The team executor instance
   */
  setTeamExecutor(executor: ITeamExecutor): void {
    this.teamExecutor = executor;
  }

  /**
   * Injects a conversation loader.
   *
   * This allows reflections to include chat history.
   *
   * @param loader - Function to load conversation history
   */
  setConversationLoader(loader: ConversationLoader): void {
    this.conversationLoader = loader;
  }

  /**
   * Injects a workspace scanner.
   *
   * This allows reflections to include workspace context.
   *
   * @param scanner - Function to scan agent workspaces
   */
  setWorkspaceScanner(scanner: WorkspaceScanner): void {
    this.workspaceScanner = scanner;
  }

  /**
   * Gathers all context needed for an agent's reflection.
   *
   * Loads in parallel:
   * - Agent statistics
   * - Recent tasks (last 20, sorted by recency)
   * - Current soul
   * - Recent conversations (last 30)
   * - Workspace summary
   * - Past proactive tasks (for deduplication)
   *
   * @async
   * @param agentId - The agent ID to gather context for
   * @returns The gathered reflection context
   */
  async gatherContext(agentId: string): Promise<ReflectionContext> {
    const [stats, allTasks, soul, recentConversations, workspace] = await Promise.all([
      this.statsStore.get(agentId),
      this.taskStore.list({ assignedTo: agentId }),
      this.soulManager.load(agentId),
      this.conversationLoader
        ? this.conversationLoader(agentId, 30)
        : Promise.resolve([]),
      this.workspaceScanner
        ? this.workspaceScanner(agentId).catch(() => null)
        : Promise.resolve(null),
    ]);

    // Sort by most recent, limit to last 20
    const sorted = allTasks
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )
      .slice(0, 20);

    // Collect all proactive tasks (any status) so the LLM knows not to recreate them
    const pastProactiveTasks = allTasks.filter(t => t.tags?.includes('proactive'));

    return { stats, recentTasks: sorted, recentConversations, soul, workspace, pastProactiveTasks };
  }

  /**
   * Triggers a self-contained reflection for an agent.
   *
   * This method:
   * 1. Gathers context for the agent
   * 2. Builds a reflection prompt
   * 3. Executes the prompt via TeamExecutor
   * 4. Parses the LLM response
   * 5. Applies the results (soul evolution + proactive task creation)
   *
   * Requires setTeamExecutor() to have been called first.
   *
   * @async
   * @param agentId - The agent ID to trigger reflection for
   * @returns The reflection result, or null if TeamExecutor is not set
   */
  async triggerReflection(agentId: string): Promise<ReflectionResult | null> {
    if (!this.teamExecutor) {
      log.warn('No TeamExecutor set — cannot trigger reflection autonomously');
      return null;
    }

    const context = await this.gatherContext(agentId);
    const prompt = this.buildReflectionPrompt(context);

    try {
      const raw = await this.teamExecutor.execute('self:reflect', prompt);
      const result = this.parseReflectionResult(raw);
      await this.applyReflection(agentId, result);
      log.info(`Reflection complete for ${agentId}: ${result.newLearnings.length} learnings, ${result.proactiveTasks.length} tasks`);
      return result;
    } catch (error) {
      log.error(`Reflection failed for ${agentId}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * Applies reflection results to an agent.
   *
   * This method:
   * 1. Evolves the soul with new role, learnings, traits, and goals
   * 2. Creates proactive tasks (deduplicated against existing tasks)
   * 3. Emits TASK_CREATED events for each new task
   *
   * Proactive tasks are assigned back to the reflecting agent.
   * These are actions the agent identified it should take to help the user.
   *
   * @async
   * @param agentId - The agent ID to apply reflections to
   * @param result - The reflection result to apply
   */
  async applyReflection(
    agentId: string,
    result: ReflectionResult,
  ): Promise<void> {
    // Evolve soul with reflection results
    await this.soulManager.evolve(agentId, {
      role: result.role || undefined,
      newLearnings: result.newLearnings,
      traitAdjustments: result.traitAdjustments,
      newGoals: result.newGoals,
    });

    // Deduplicate proactive tasks against existing ones (any status)
    const existingTasks = await this.taskStore.list({ assignedTo: agentId });
    const existingProactiveTitles = new Set(
      existingTasks
        .filter(t => t.tags?.includes('proactive'))
        .map(t => t.title.toLowerCase().trim()),
    );

    // Create proactive tasks — assigned back to the reflecting agent.
    // These are actions the agent identified it should take to help the user.
    for (const taskDef of result.proactiveTasks) {
      const normalizedTitle = taskDef.title.toLowerCase().trim();
      if (existingProactiveTitles.has(normalizedTitle)) {
        log.debug(`Skipping duplicate proactive task: "${taskDef.title}"`);
        continue;
      }
      existingProactiveTitles.add(normalizedTitle);

      const task = await this.taskStore.create({
        title: taskDef.title,
        description: taskDef.description,
        status: 'assigned',
        priority: 'normal',
        source: 'agent',
        assignedTo: agentId,
        createdBy: agentId,
        createdAt: new Date().toISOString(),
        tags: ['proactive'],
      });

      this.eventBus.emit(Events.TASK_CREATED, { task });
    }
  }

  /**
   * Builds the reflection prompt for an agent.
   *
   * This constructs a detailed prompt that includes:
   * - Instructions for the LLM
   * - Agent statistics (tasks completed, failed, success rate, etc.)
   * - Recent task history
   * - Past proactive tasks (to avoid duplicates)
   * - Recent conversations with the user
   * - Workspace contents
   * - Current soul structure
   *
   * The prompt instructs the LLM to:
   * 1. Define/refine the agent's role based on work patterns
   * 2. Extract specific learnings from interactions
   * 3. Adjust traits based on evidence (not aspirationally)
   * 4. Identify proactive tasks the agent should undertake
   *
   * @param context - The reflection context
   * @returns The formatted prompt string
   */
  buildReflectionPrompt(context: ReflectionContext): string {
    const { stats, recentTasks, recentConversations, soul, workspace, pastProactiveTasks } = context;

    const lines: string[] = [
      'You are reflecting on your recent work to improve yourself and help the user proactively.',
      '',
      '## What to do',
      '1. Define or refine your ROLE — based on the work you have done and conversations with the user, what role best describes you?',
      '   - Examples: "Frontend Developer", "Marketing Analyst", "DevOps Engineer", "Sales Strategist"',
      '   - This should emerge naturally from your conversations and task history, not be aspirational',
      '   - Keep it concise (2-5 words). If you have no history, leave it empty.',
      '2. Analyze your conversations and task history — what did the user ask you to do? What patterns emerge?',
      '3. Extract specific learnings from your interactions and task outcomes',
      '4. Adjust your traits based on evidence (not aspirationally)',
      '5. Identify proactive actions YOU can take next to help the user, based on what they have been asking for',
      '',
      '## Rules for proactive tasks',
      '- Tasks are things YOU will execute autonomously — be specific and actionable',
      '- Base them on real patterns: repeated user requests, failed tasks worth retrying, gaps you noticed',
      '- Examples: "Run test coverage on src/ and report gaps", "Refactor the auth module that failed last time"',
      '- Do NOT create meta-tasks about yourself (no "create checklist", "write documentation", "build validator")',
      '- Do NOT create tasks you have no context for — only things related to your actual work',
      '- Do NOT recreate tasks that already exist in "Your Past Proactive Tasks" below — check the list carefully',
      '- If you have no meaningful history yet, return empty arrays for everything',
      '',
      '## Your Stats',
    ];

    if (stats) {
      const total = stats.tasksCompleted + stats.tasksFailed;
      const successRate = total > 0 ? ((stats.tasksCompleted / total) * 100).toFixed(1) : 'N/A';
      lines.push(`- Tasks completed: ${stats.tasksCompleted}`);
      lines.push(`- Tasks failed: ${stats.tasksFailed}`);
      lines.push(`- Success rate: ${successRate}%`);
      lines.push(`- Average response time: ${stats.averageResponseMs.toFixed(0)}ms`);
      lines.push(`- Current streak: ${stats.streaks.current}`);
    } else {
      lines.push('- No stats available yet — return empty arrays');
    }

    lines.push('');
    lines.push('## Your Recent Tasks');
    if (recentTasks.length === 0) {
      lines.push('- No tasks yet — return empty arrays');
    }
    for (const task of recentTasks.slice(0, 10)) {
      const parts = [`[${task.status}] ${task.title}`];
      if (task.description) parts.push(`  Description: ${task.description.slice(0, 200)}`);
      if (task.error) parts.push(`  Error: ${task.error}`);
      lines.push(`- ${parts.join('\n  ')}`);
    }

    lines.push('');
    lines.push('## Your Past Proactive Tasks (DO NOT recreate these)');
    if (pastProactiveTasks.length === 0) {
      lines.push('- None yet');
    } else {
      for (const task of pastProactiveTasks) {
        lines.push(`- [${task.status}] ${task.title}`);
      }
    }

    lines.push('');
    lines.push('## Your Recent Conversations with the User');
    if (recentConversations.length === 0) {
      lines.push('- No conversations yet');
    } else {
      for (const entry of recentConversations.slice(-20)) {
        const prefix = entry.role === 'user' ? 'User' : 'You';
        // Truncate long messages to keep prompt manageable
        const text = entry.content.length > 300
          ? entry.content.slice(0, 300) + '...'
          : entry.content;
        lines.push(`- **${prefix}**: ${text}`);
      }
    }

    lines.push('');
    lines.push('## Your Workspace');
    if (workspace && (workspace.entries.length > 0 || workspace.services.length > 0)) {
      if (workspace.entries.length > 0) {
        lines.push('Files and directories in your workspace:');
        for (const entry of workspace.entries) {
          lines.push(`- ${entry.type === 'dir' ? `${entry.name}/` : entry.name}`);
        }
      }
      if (workspace.services.length > 0) {
        lines.push('');
        lines.push('Running services you created:');
        for (const svc of workspace.services) {
          const portStr = svc.port ? `:${svc.port}` : '';
          const status = svc.alive ? 'running' : 'stopped';
          lines.push(`- ${svc.name}${portStr} (${status})`);
        }
      }
      if (workspace.notableFiles.length > 0) {
        lines.push('');
        for (const file of workspace.notableFiles) {
          lines.push(`### ${file.name}`);
          lines.push(file.content);
        }
      }
    } else {
      lines.push('- Empty workspace — no files created yet');
    }

    lines.push('');
    lines.push('## Your Current Soul');
    lines.push(`- Role: ${soul.role || 'not yet defined — define one based on your work'}`);
    lines.push(`- Persona: ${soul.persona || 'not set'}`);
    if (soul.goals.length > 0) {
      lines.push(`- Goals: ${soul.goals.join(', ')}`);
    }
    if (soul.learnings.length > 0) {
      lines.push(`- Recent learnings: ${soul.learnings.slice(-5).join(', ')}`);
    }

    // List existing traits so the LLM reuses canonical names
    const existingTraits = Object.entries(soul.traits);
    if (existingTraits.length > 0) {
      lines.push('');
      lines.push('## Your Existing Traits (use these exact names)');
      for (const [name, value] of existingTraits) {
        lines.push(`- ${name}: ${value}`);
      }
      lines.push('');
      lines.push('IMPORTANT: When adjusting traits, you MUST use the exact trait names listed above.');
      lines.push('Do NOT create synonyms or variants (e.g., do not add "proactiveness" if "proactive" exists).');
      lines.push('Only add a genuinely new trait if it represents a concept not already covered.');
    }

    lines.push('');
    lines.push('Respond with a JSON object:');
    lines.push('```json');
    lines.push('{');
    lines.push('  "role": "Your Role Title (2-5 words)",');
    lines.push('  "newLearnings": ["specific lesson from task X", ...],');
    lines.push('  "traitAdjustments": { "existing_trait_name": 0.05, ... },');
    lines.push('  "newGoals": ["goal based on observed pattern", ...],');
    lines.push('  "proactiveTasks": [{ "title": "...", "description": "..." }, ...]');
    lines.push('}');
    lines.push('```');

    return lines.join('\n');
  }

  /**
   * Parses LLM JSON response, extracting from markdown code fences if needed.
   *
   * Handles both plain JSON and markdown-wrapped JSON (```json ... ```).
   * Supports both old "improvementTasks" and new "proactiveTasks" keys.
   *
   * @param raw - The raw LLM response
   * @returns The parsed reflection result
   * @private
   */
  private parseReflectionResult(raw: string): ReflectionResult {
    // Strip markdown code fences if present
    let json = raw.trim();
    const fenceMatch = json.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      json = fenceMatch[1].trim();
    }

    const parsed = JSON.parse(json) as Record<string, unknown>;

    return {
      role: typeof parsed.role === 'string' ? parsed.role : '',
      newLearnings: Array.isArray(parsed.newLearnings) ? parsed.newLearnings : [],
      traitAdjustments: parsed.traitAdjustments && typeof parsed.traitAdjustments === 'object'
        ? parsed.traitAdjustments as Record<string, number>
        : {},
      newGoals: Array.isArray(parsed.newGoals) ? parsed.newGoals : [],
      // Support both old "improvementTasks" and new "proactiveTasks" key
      proactiveTasks: Array.isArray(parsed.proactiveTasks)
        ? parsed.proactiveTasks
        : Array.isArray(parsed.improvementTasks)
          ? parsed.improvementTasks as Array<{ title: string; description: string }>
          : [],
    };
  }
}
