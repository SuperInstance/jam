import { useEffect } from 'react';
import { useAppStore } from '@/store';
import { useTeamStats } from '@/hooks/useTeamStats';
import { TeamOverview } from '@/components/dashboard/TeamOverview';
import { RelationshipGraph } from '@/components/dashboard/RelationshipGraph';
import type { SoulEntry } from '@/store/teamSlice';

interface TeamOverviewContainerProps {
  onSelectAgent: (agentId: string) => void;
}

export function TeamOverviewContainer({ onSelectAgent }: TeamOverviewContainerProps) {
  const agents = useAppStore((s) => s.agents);
  const souls = useAppStore((s) => s.souls);
  const setSoul = useAppStore((s) => s.setSoul);
  const { stats, relationships, isLoading } = useTeamStats();

  // Load souls for all agents to display role info
  const agentValues = Object.values(agents);
  useEffect(() => {
    for (const agent of agentValues) {
      if (!souls[agent.profile.id]) {
        window.jam.team.soul.get(agent.profile.id).then((result) => {
          if (result) setSoul(agent.profile.id, result as unknown as SoulEntry);
        });
      }
    }
  }, [agentValues, souls, setSoul]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48 text-zinc-500">
        Loading team data...
      </div>
    );
  }

  const agentList = agentValues.map((a) => ({
    id: a.profile.id,
    name: a.profile.name,
    color: a.profile.color,
    status: a.status,
    role: souls[a.profile.id]?.role ?? undefined,
  }));

  return (
    <div className="space-y-6">
      <TeamOverview
        agents={agentList}
        stats={stats}
        onSelectAgent={onSelectAgent}
      />

      {agentList.length > 1 && (
        <div className="bg-zinc-800/50 rounded-lg p-4">
          <h3 className="text-sm font-medium text-zinc-300 mb-3">
            Relationship Graph
          </h3>
          <div className="flex justify-center">
            <RelationshipGraph
              agents={agentList}
              relationships={relationships}
              onSelectAgent={onSelectAgent}
            />
          </div>
        </div>
      )}
    </div>
  );
}
