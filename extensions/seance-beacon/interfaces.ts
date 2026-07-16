// Capture-side adapter seams for the standalone pi-seance-beacon package.
//
// This package is the BEACON (capture side) of seance. It ships only the two
// seams the beacon touches:
//   - AgentAdapter  (snapshot() extracts the agent's internal session identity)
//   - TransportAdapter (emit() persists the BeaconRecord)
//
// The restore-side seams (MuxAdapter, PaneHandle, buildRestorePlan) live in the
// seance monorepo alongside the CLI; they are intentionally NOT shipped here so
// this package stays installable without the full seance tree.
//
// AgentAdapter keeps its resumeCommand()/sessionExists() members for parity with
// seance's PiAgentAdapter (the beacon only calls snapshot(), but shipping the
// full adapter keeps the two trees trivially reconcilable). See AGENTS.md.
//
// RULE (carried from seance): no code outside a registry may branch on
// `agent.type`. The beacon resolves adapters through the registry seam.

import type { AgentIdentity, BeaconRecord } from "./types.js";

export interface AgentAdapter {
  type: string;
  /** Capture side — hosted by the agent's own plugin/hook mechanism. */
  snapshot(ctx: unknown): AgentIdentity | null;
  /** Resume side — used by `seance restore`; unused by the beacon but kept for
   *  parity with the seance monorepo's PiAgentAdapter. */
  resumeCommand(id: AgentIdentity, cwd: string): string;
  sessionExists(id: AgentIdentity): Promise<boolean>;
}

export interface TransportAdapter {
  /** MUST be non-throwing: on failure, warn + spool. [LD5] */
  emit(record: BeaconRecord): Promise<void>;
}
