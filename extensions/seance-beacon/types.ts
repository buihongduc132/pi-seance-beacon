// BeaconRecord is THE contract between adapters and the agent-agnostic stack.
// Versioned; additive changes only. See flow/plans/00-overview.md + 40-adapter-abstraction.md.
// M1 adds LiveRegistry so the file store has a stable top-level envelope.

export interface AgentIdentity {
  type: string; // "pi" | "claude" | "codex" | "gemini" | ...
  session_id: string; // strictly [A-Za-z0-9_-]+ per SAFE_SESSION_ID rule; resume key
  session_file?: string;
  name?: string;
  model?: string;
}

export interface TmuxCoords {
  socket?: string;
  session: string;
  window_idx: number;
  window_name?: string;
  pane_id: string; // "%6" — save-time identity only, never a durable key
  pane_idx: number;
  layout?: string; // #{window_layout}
}

export interface WeztermCoords {
  workspace?: string;
  window_id: number;
  tab_id: number;
  pane_id: number; // save-time identity only
  tab_title?: string;
  domain?: string;
  size?: { rows: number; cols: number; pixel_width?: number; pixel_height?: number };
}

export interface BeaconRecord {
  v: 1;
  ts: string; // ISO-8601, UTC
  agent: AgentIdentity;
  cwd: string;
  containers: { tmux?: TmuxCoords; wezterm?: WeztermCoords };
  host: string;
  pid: number;
  ended?: boolean; // set on session_shutdown
}

// Live registry envelope: the current, deduplicated map of running sessions.
// Deduplication key is (host, agent.type, session_id) — NOT pane id. [LD3]
export interface LiveRegistry {
  v: 1;
  ts: string; // last write time, ISO-8601 UTC
  records: BeaconRecord[];
}

export interface Snapshot {
  v: 1;
  ts: string;
  records: BeaconRecord[];
  topology?: unknown; // reserved for M2 layout summary; optional preserves M1 compatibility
}
