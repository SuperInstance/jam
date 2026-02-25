import { useMemo } from 'react';
import { AgentStatCard } from '@/components/dashboard/AgentStatCard';

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function estimateCost(tokensIn: number, tokensOut: number): number {
  return (tokensIn * 3 + tokensOut * 15) / 1_000_000;
}

interface StatEntry {
  tasksCompleted: number;
  tasksFailed: number;
  totalTokensIn: number;
  totalTokensOut: number;
  averageResponseMs: number;
  streaks: { current: number };
}

interface TeamOverviewProps {
  agents: Array<{ id: string; name: string; color: string; status: string; role?: string }>;
  stats: Record<string, StatEntry>;
  onSelectAgent: (agentId: string) => void;
}

export function TeamOverview({ agents, stats, onSelectAgent }: TeamOverviewProps) {
  const totals = useMemo(() => {
    let tasksCompleted = 0;
    let tasksFailed = 0;
    let tokensIn = 0;
    let tokensOut = 0;
    for (const s of Object.values(stats)) {
      tasksCompleted += s.tasksCompleted;
      tasksFailed += s.tasksFailed;
      tokensIn += s.totalTokensIn ?? 0;
      tokensOut += s.totalTokensOut ?? 0;
    }
    return { tasksCompleted, tasksFailed, tokensIn, tokensOut };
  }, [stats]);

  const totalTokens = totals.tokensIn + totals.tokensOut;
  const totalCost = estimateCost(totals.tokensIn, totals.tokensOut);

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white">Team Overview</h2>

        {/* Totals summary */}
        <div className="flex items-center gap-4 text-xs text-zinc-400">
          <span>
            {totals.tasksCompleted + totals.tasksFailed} tasks
            <span className="text-zinc-600 ml-1">
              ({totals.tasksCompleted} ok / {totals.tasksFailed} fail)
            </span>
          </span>
          {totalTokens > 0 && (
            <>
              <span className="w-px h-3 bg-zinc-700" />
              <span>
                {formatTokens(totalTokens)} tokens
              </span>
              <span className="text-emerald-400 font-medium">
                ~${totalCost.toFixed(2)}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {agents.map((agent) => (
          <AgentStatCard
            key={agent.id}
            agent={agent}
            stats={stats[agent.id] ?? null}
            onClick={() => onSelectAgent(agent.id)}
          />
        ))}
      </div>
    </div>
  );
}
