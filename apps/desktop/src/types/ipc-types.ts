// Shared IPC types - used by both preload.ts and store slices

export interface StatsEntry {
  agentId: string;
  tasksCompleted: number;
  tasksFailed: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalExecutionMs: number;
  averageResponseMs: number;
  uptime: number;
  lastActive: string;
  streaks: { current: number; best: number };
}

export interface RelationshipEntry {
  sourceAgentId: string;
  targetAgentId: string;
  trustScore: number;
  interactionCount: number;
  lastInteraction: string;
  delegationCount: number;
  delegationSuccessRate: number;
  notes: string[];
}

export interface SoulEntry {
  persona: string;
  role: string;
  traits: Record<string, number>;
  goals: string[];
  strengths: string[];
  weaknesses: string[];
  learnings: string[];
  lastReflection: string;
  version: number;
}

export interface ChannelEntry {
  id: string;
  name: string;
  type: string;
  participants: string[];
  createdAt: string;
}

export interface ChannelMessageEntry {
  id: string;
  channelId: string;
  senderId: string;
  content: string;
  timestamp: string;
  replyTo?: string;
}

export interface TaskEntry {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  source: string;
  createdBy: string;
  assignedTo?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  result?: string;
  error?: string;
  tags: string[];
  parentTaskId?: string;
}

export interface ScheduleEntry {
  id: string;
  name: string;
  pattern: {
    cron?: string;
    intervalMs?: number;
  };
  taskTemplate: {
    title: string;
    description: string;
    priority?: string;
    assignedTo?: string;
    tags?: string[];
  };
  enabled: boolean;
  lastRun?: string;
  nextRun?: string;
}

export interface ImprovementEntry {
  id: string;
  agentId: string;
  title: string;
  description: string;
  status: 'proposed' | 'approved' | 'executing' | 'completed' | 'failed' | 'rolled_back';
  proposedAt: string;
  executedAt?: string;
  completedAt?: string;
  changes?: string[];
  error?: string;
}
