// pi-seance-beacon — pi extension entry point.
//
// pi's extension auto-loader resolves this package (because package.json declares
// `pi.extensions: ["./extensions"]`) and calls the default export with the pi
// ExtensionAPI. We compose the capture side: a FileStore (default transport) +
// the MuxProbe + activate() from seance-beacon.ts.
//
// All runtime behavior is env-driven so the same installed package works for any
// host without code changes:
//   SEANCE_STORE_DIR            (default ~/.local/share/seance)
//   SEANCE_BEACON_HEARTBEAT_SEC (default 60)
//   SEANCE_BEACON_MUX_TIMEOUT_MS (default 2000)
//
// LD5: every failure path is caught and warned — the beacon MUST NEVER crash the
// host agent. activate() itself is non-throwing; we wrap the composition in a
// try/catch as a belt-and-suspenders guard so a bad env value (e.g. non-numeric
// heartbeat) cannot take pi down.
//
// `_pi` is intentionally untyped here (structural local interface) to avoid
// coupling the entry's typecheck to the user-machine pi-coding-agent package
// path — same pattern as the lint-on-edit entry in the pi-plugins fleet.

// @ts-nocheck

import { homedir } from 'node:os';
import { join } from 'node:path';
import { activate } from './seance-beacon.js';
import { FileStore } from './file-store.js';

interface PiExtensionAPI {
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

function readStoreDir(): string {
  const envDir = process.env.SEANCE_STORE_DIR?.trim();
  if (envDir && envDir.length > 0) return envDir;
  return join(homedir(), '.local', 'share', 'seance');
}

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

export default function seanceBeacon(pi: PiExtensionAPI): void {
  try {
    const storeDir = readStoreDir();
    const heartbeatSec = readPositiveInt('SEANCE_BEACON_HEARTBEAT_SEC', 60);
    const muxTimeoutMs = readPositiveInt('SEANCE_BEACON_MUX_TIMEOUT_MS', 2000);

    const store = new FileStore({ storeDir, lockTimeoutMs: 1000 });

    // activate() registers the pi.on('input'|'session_start'|'session_shutdown')
    // handlers + the heartbeat timer. It is non-throwing (LD5); we still guard
    // the composition so a misconfiguration cannot reach the host.
    void activate(pi, {
      store,
      heartbeatSec,
      muxProbeTimeoutMs: muxTimeoutMs,
    });

    pi?.logger?.info?.(`[seance] beacon active → ${storeDir} (heartbeat ${heartbeatSec}s)`);
  } catch (err) {
    // Never crash the host. Surface the failure as a warning only.
    try {
      pi?.logger?.warn?.(`[seance] beacon activation failed: ${(err as Error)?.message ?? err}`);
    } catch {
      /* logger optional / may throw */
    }
  }
}
