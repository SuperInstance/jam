/**
 * Payload builder utilities for constructing consistent IPC payloads.
 * Reduces duplication of agent info extraction patterns.
 */

import type { AgentState } from '@jam/core';

export interface AgentInfoPayload {
  agentId: string;
  agentName: string;
  agentRuntime: string;
  agentColor: string;
}

/**
 * Build a standard agent info payload from an agent state.
 * Provides defaults for missing values.
 */
export function buildAgentPayload(agent: AgentState | null | undefined): AgentInfoPayload {
  return {
    agentId: agent?.profile.id ?? '',
    agentName: agent?.profile.name ?? 'Agent',
    agentRuntime: agent?.profile.runtime ?? '',
    agentColor: agent?.profile.color ?? '#6b7280',
  };
}

/**
 * Build an agent info payload with additional fields.
 * Useful for acknowledgments, progress, and responses.
 */
export function buildAgentPayloadWith<T extends Record<string, unknown>>(
  agent: AgentState | null | undefined,
  extras: T,
): AgentInfoPayload & T {
  return {
    ...buildAgentPayload(agent),
    ...extras,
  };
}

/**
 * Type for a function that gets agent state by ID.
 * Matches AgentManager.get() signature.
 */
type GetAgentFn = (agentId: string) => AgentState | undefined;

/**
 * Build an agent info payload by looking up the agent by ID.
 * Returns null if agent not found.
 */
export function buildAgentPayloadFromId(
  agentId: string,
  getAgent: GetAgentFn,
): AgentInfoPayload | null {
  const agent = getAgent(agentId);
  if (!agent) return null;
  return buildAgentPayload(agent);
}

/**
 * Build an agent info payload by ID with additional fields.
 * Returns null if agent not found.
 */
export function buildAgentPayloadFromIdWith<T extends Record<string, unknown>>(
  agentId: string,
  getAgent: GetAgentFn,
  extras: T,
): (AgentInfoPayload & T) | null {
  const agent = getAgent(agentId);
  if (!agent) return null;
  return buildAgentPayloadWith(agent, extras);
}
