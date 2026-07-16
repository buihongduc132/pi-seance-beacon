import { describe, it, expect, vi, beforeEach } from 'vitest';
import { activate } from './seance-beacon.js';
import type { TransportAdapter } from './interfaces.js';
import type { BeaconRecord } from './types.js';

interface PiExtensionAPI {
  on(event: 'input' | 'session_start' | 'session_shutdown', handler: (ctx: any) => void | Promise<void>): void;
  logger: { warn: (msg: string) => void; info: (msg: string) => void };
  cwd: string;
  sessionManager: { getSessionFile(): string };
}

// Stub mux probe — unit tests must never spawn real tmux/wezterm.
const noProbe = { locate: async () => null };

function createMockPi(sessionFile: string): PiExtensionAPI & { on: ReturnType<typeof vi.fn> } {
  return {
    on: vi.fn(),
    logger: { warn: vi.fn(), info: vi.fn() },
    cwd: '/home/bhd/project',
    sessionManager: { getSessionFile: () => sessionFile },
  };
}

function createMockStore(): TransportAdapter & { emit: ReturnType<typeof vi.fn> } {
  return { emit: vi.fn(async (_r: BeaconRecord) => {}) };
}

describe('seance-beacon extension event wiring', () => {
  let pi: ReturnType<typeof createMockPi>;
  let store: ReturnType<typeof createMockStore>;

  beforeEach(() => {
    pi = createMockPi('/tmp/ses_test123.jsonl');
    store = createMockStore();
  });

  it('registers handlers for input, session_start, and session_shutdown', async () => {
    await activate(pi, { store, heartbeatSec: 60, muxProbeTimeoutMs: 500, muxProbe: noProbe });
    expect(pi.on).toHaveBeenCalledWith('input', expect.any(Function));
    expect(pi.on).toHaveBeenCalledWith('session_start', expect.any(Function));
    expect(pi.on).toHaveBeenCalledWith('session_shutdown', expect.any(Function));
  });

  it('emits a BeaconRecord on user input', async () => {
    await activate(pi, { store, heartbeatSec: 60, muxProbeTimeoutMs: 500, muxProbe: noProbe });
    const inputHandler = pi.on.mock.calls.find((c: any[]) => c[0] === 'input')?.[1] as (ctx: any) => void | Promise<void>;
    expect(inputHandler).toBeDefined();

    await inputHandler({ cwd: '/home/bhd/project' });

    expect(store.emit).toHaveBeenCalledTimes(1);
    const record = (store.emit as ReturnType<typeof vi.fn>).mock.calls[0][0] as BeaconRecord;
    expect(record.agent.type).toBe('pi');
    expect(record.cwd).toBe('/home/bhd/project');
  });

  it('marks ended=true on session_shutdown', async () => {
    await activate(pi, { store, heartbeatSec: 60, muxProbeTimeoutMs: 500, muxProbe: noProbe });
    const shutdownHandler = pi.on.mock.calls.find((c: any[]) => c[0] === 'session_shutdown')?.[1] as (ctx: any) => void | Promise<void>;
    expect(shutdownHandler).toBeDefined();

    await shutdownHandler({});

    const record = (store.emit as ReturnType<typeof vi.fn>).mock.calls[0][0] as BeaconRecord;
    expect(record.ended).toBe(true);
  });

  it('installs a periodic heartbeat between session_start and session_shutdown', async () => {
    vi.useFakeTimers();
    await activate(pi, { store, heartbeatSec: 60, muxProbeTimeoutMs: 500, muxProbe: noProbe });

    const startHandler = pi.on.mock.calls.find((c: any[]) => c[0] === 'session_start')?.[1] as () => void | Promise<void>;
    expect(startHandler).toBeDefined();
    await startHandler();

    expect(store.emit).toHaveBeenCalledTimes(1); // initial start beacon
    await vi.advanceTimersByTimeAsync(60_000);
    expect(store.emit).toHaveBeenCalledTimes(2); // first heartbeat

    vi.useRealTimers();
  });

  // D1 regression: the beacon MUST await the mux probe and populate record.containers
  // with tmux coords. Previously probe.locate() was fire-and-forget and the result
  // was discarded — every record shipped with containers:{}.
  it('populates record.containers with the mux-probe result (tmux coords captured)', async () => {
    const fakeProbe = {
      locate: vi.fn(async () => ({
        tmux: {
          session: 'work',
          window_idx: 1,
          window_name: 'main',
          pane_id: '%6',
          pane_idx: 0,
          layout: 'b25e,80x24,0,0,0',
        },
      })),
    };
    await activate(pi, { store, heartbeatSec: 60, muxProbeTimeoutMs: 500, muxProbe: fakeProbe });
    const inputHandler = pi.on.mock.calls.find((c: any[]) => c[0] === 'input')?.[1] as (ctx: any) => void | Promise<void>;
    await inputHandler({ cwd: '/home/bhd/project' });

    expect(fakeProbe.locate).toHaveBeenCalledTimes(1);
    const record = (store.emit as ReturnType<typeof vi.fn>).mock.calls[0][0] as BeaconRecord;
    expect(record.containers.tmux).toBeDefined();
    expect(record.containers.tmux?.session).toBe('work');
    expect(record.containers.tmux?.pane_id).toBe('%6');
    expect(record.containers.tmux?.layout).toBe('b25e,80x24,0,0,0');
  });

  it('emits with empty containers when the mux probe fails (LD5: never abort)', async () => {
    const failingProbe = { locate: vi.fn(async () => Promise.reject(new Error('no tmux'))) };
    await activate(pi, { store, heartbeatSec: 60, muxProbeTimeoutMs: 500, muxProbe: failingProbe });
    const inputHandler = pi.on.mock.calls.find((c: any[]) => c[0] === 'input')?.[1] as (ctx: any) => void | Promise<void>;
    await inputHandler({ cwd: '/home/bhd/project' });

    // Still emits — degraded to empty containers, never crashes.
    expect(store.emit).toHaveBeenCalledTimes(1);
    const record = (store.emit as ReturnType<typeof vi.fn>).mock.calls[0][0] as BeaconRecord;
    expect(record.containers).toEqual({});
  });
});
