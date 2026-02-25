// Re-export domain types from @jam/core (single source of truth)
export type { ContainerInfo, CreateContainerOptions } from '@jam/core';

export interface SandboxConfig {
  /** Whether sandbox mode is enabled */
  enabled: boolean;
  /** CPU limit per container (Docker --cpus) */
  cpus: number;
  /** Memory limit in MB per container (Docker --memory) */
  memoryMb: number;
  /** Max number of processes per container (Docker --pids-limit) */
  pidsLimit: number;
  /** First host port in the mapped range */
  portRangeStart: number;
  /** Number of ports allocated per agent */
  portsPerAgent: number;
  /** Docker image name for agent containers */
  imageName: string;
  /** Seconds to wait for container stop before killing */
  stopTimeoutSec: number;
  /** Port for the host bridge HTTP server (agents call from containers) */
  hostBridgePort: number;
}

export const DEFAULT_SANDBOX_CONFIG: SandboxConfig = {
  enabled: false,
  cpus: 2,
  memoryMb: 4096,
  pidsLimit: 256,
  portRangeStart: 10_000,
  portsPerAgent: 20,
  imageName: 'jam-agent:latest',
  stopTimeoutSec: 10,
  hostBridgePort: 19_876,
};
