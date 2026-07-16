import { hostname } from 'node:os';
import type { TransportAdapter } from './interfaces.js';
import type { AgentAdapter } from './interfaces.js';
import type { BeaconRecord } from './types.js';
import { PiAgentAdapter } from './pi-agent-adapter.js';
import { MuxProbe } from './mux-probe.js';

// The agent adapter is injected so a future multi-agent build can swap it via the
// registry. M1 ships only pi; the beacon stays agent-agnostic at this seam.

export interface BeaconOptions {
  store: TransportAdapter;
  heartbeatSec: number;
  muxProbeTimeoutMs: number;
  /** Injectable agent adapter (defaults to PiAgentAdapter). Lets tests + future
   *  multi-agent builds swap adapters without touching beacon internals. */
  agentAdapter?: AgentAdapter;
  /** Injectable mux probe factory (defaults to MuxProbe). Lets tests stub the
   *  container capture so the beacon unit suite never spawns real tmux/wezterm. */
  muxProbe?: { locate(env: NodeJS.ProcessEnv): Promise<BeaconRecord['containers'] | null> };
}

export interface PiExtensionAPI {
  on(
    event: 'input' | 'session_start' | 'session_shutdown',
    handler: (ctx: unknown) => void | Promise<void>,
  ): void;
  cwd?: string;
  sessionManager?: { getSessionFile(): string | null | undefined };
  sessionName?: string;
  meta?: { name?: string; model?: string };
  logger?: { warn: (msg: string) => void; info: (msg: string) => void };
}

export async function activate(pi: PiExtensionAPI, opts: BeaconOptions): Promise<void> {
  const agentAdapter = opts.agentAdapter ?? new PiAgentAdapter();
  // The mux probe locates tmux/wezterm coords for the current pane. Injectable so
  // tests can verify container capture without spawning real tmux/wezterm.
  const probe = opts.muxProbe ?? new MuxProbe({ timeoutMs: opts.muxProbeTimeoutMs });
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  function warn(message: string): void {
    try {
      pi?.logger?.warn?.(`[seance] ${message}`);
    } catch {
      /* logger is optional and may throw */
    }
  }

  // emitBeacon is async: it MUST await probe.locate() so the captured record
  // carries the tmux/wezterm coords. LD5 still holds — probe/emit failures are
  // caught and warned, never thrown out of the handler.
  async function emitBeacon(ctx: unknown, ended = false): Promise<void> {
    try {
      const snapshotCtx = {
        ...(typeof ctx === 'object' && ctx !== null ? ctx : {}),
        sessionManager: (ctx as { sessionManager?: { getSessionFile(): string | null | undefined } })?.sessionManager ?? pi?.sessionManager,
        sessionName: (ctx as { sessionName?: string })?.sessionName ?? pi?.sessionName,
        meta: (ctx as { meta?: { name?: string; model?: string } })?.meta ?? pi?.meta,
      };
      const agent = agentAdapter.snapshot(snapshotCtx);
      if (!agent) return;

      // Capture container coords BEFORE building the record so the emitted
      // BeaconRecord carries the full topology (cwd/session/window/pane/layout).
      // Probe failure degrades to empty containers — never aborts the beacon [LD5].
      let containers: BeaconRecord['containers'] = {};
      try {
        const located = await probe.locate(process.env) as BeaconRecord['containers'] | null;
        if (located) containers = located;
      } catch (err) {
        warn(`mux probe failed (continuing without container coords): ${(err as Error)?.message ?? err}`);
      }

      const record: BeaconRecord = {
        v: 1,
        ts: new Date().toISOString(),
        agent,
        cwd: ((ctx as { cwd?: string })?.cwd ?? pi?.cwd) || '',
        containers,
        host: hostname(),
        pid: process.pid,
      };
      if (ended) record.ended = true;

      // Emit — never throw out of the handler [LD5].
      try {
        await opts.store.emit(record);
      } catch (err) {
        warn(`emit failed: ${(err as Error)?.message ?? err}`);
      }
    } catch (err) {
      warn(`beacon error: ${(err as Error)?.message ?? err}`);
    }
  }

  pi.on('input', (ctx) => {
    return emitBeacon(ctx, false);
  });

  pi.on('session_start', (ctx) => {
    const initial = emitBeacon(ctx, false);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => {
      void emitBeacon(ctx, false);
    }, opts.heartbeatSec * 1000);
    return initial;
  });

  pi.on('session_shutdown', (ctx) => {
    const final = emitBeacon(ctx, true);
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    return final;
  });
}
