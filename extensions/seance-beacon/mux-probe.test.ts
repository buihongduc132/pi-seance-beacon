import { describe, it, expect, vi } from 'vitest';
import { MuxProbe } from './mux-probe.js';
import type { ExecFn } from './mux-probe.js';

// Mock exec: returns the configured stdout for a given argv signature.
function mockExec(table: { match: RegExp; stdout?: string; stderr?: string; error?: string; delayMs?: number }[]): ExecFn {
  return vi.fn(async (cmd: string, args: string[], _timeoutMs: number) => {
    const sig = `${cmd} ${args.join(' ')}`;
    const entry = table.find((e) => e.match.test(sig));
    if (!entry) {
      const err = new Error(`unexpected command: ${sig}`) as Error & { code?: string };
      err.code = 'ENOENT';
      throw err;
    }
    if (entry.delayMs) await new Promise((r) => setTimeout(r, entry.delayMs));
    if (entry.error) {
      const err = new Error(entry.error) as Error & { code?: string };
      err.code = 'ENOENT';
      throw err;
    }
    return { stdout: entry.stdout ?? '', stderr: entry.stderr ?? '', exitCode: 0 };
  }) as unknown as ExecFn;
}

describe('MuxProbe — tmux env detection', () => {
  it('parses tmux display-message output into TmuxCoords', async () => {
    const env = {
      TMUX: '/tmp/tmux-1000/default,1234,0',
      TMUX_PANE: '%6',
    } as NodeJS.ProcessEnv;

    const exec = mockExec([
      {
        match: /tmux display-message/,
        stdout: 'main|0:editor|0|%6,80x24,0,0,1',
      },
    ]);
    const probe = new MuxProbe({ timeoutMs: 500, exec });
    const coords = await probe.locate(env);

    expect(coords.tmux).toBeDefined();
    expect(coords.tmux?.session).toBe('main');
    expect(coords.tmux?.pane_id).toBe('%6');
    expect(coords.tmux?.window_idx).toBe(0);
    expect(coords.tmux?.pane_idx).toBe(0);
  });

  it('returns null tmux block when TMUX/TMUX_PANE are absent', async () => {
    const env = {} as NodeJS.ProcessEnv;
    const exec = mockExec([]);
    const probe = new MuxProbe({ timeoutMs: 500, exec });
    const coords = await probe.locate(env);
    expect(coords.tmux).toBeUndefined();
  });

  it('degrades gracefully when tmux subprocess fails (partial data beats no data)', async () => {
    const env = { TMUX: '/tmp/x,1,0', TMUX_PANE: '%6' } as NodeJS.ProcessEnv;
    const exec = mockExec([{ match: /tmux display-message/, error: 'no server' }]);
    const probe = new MuxProbe({ timeoutMs: 500, exec });
    const coords = await probe.locate(env);
    expect(coords.tmux).toBeUndefined();
  });
});

describe('MuxProbe — wezterm env detection', () => {
  it('parses `wezterm cli list --format json` into WeztermCoords', async () => {
    const env = {
      WEZTERM_PANE: '12',
      WEZTERM_UNIX_SOCKET: '/run/user/1000/wezterm/gui.sock',
    } as NodeJS.ProcessEnv;

    const list = JSON.stringify([
      {
        pane_id: 12,
        window_id: 1,
        tab_id: 0,
        workspace: 'default',
        tab_title: 'main',
        domain: 'local',
      },
    ]);

    const exec = mockExec([{ match: /wezterm cli list/, stdout: list }]);
    const probe = new MuxProbe({ timeoutMs: 500, exec });
    const coords = await probe.locate(env);

    expect(coords.wezterm).toBeDefined();
    expect(coords.wezterm?.pane_id).toBe(12);
    expect(coords.wezterm?.window_id).toBe(1);
    expect(coords.wezterm?.workspace).toBe('default');
  });

  it('returns undefined wezterm when WEZTERM_PANE is absent', async () => {
    const env = {} as NodeJS.ProcessEnv;
    const exec = mockExec([]);
    const probe = new MuxProbe({ timeoutMs: 500, exec });
    const coords = await probe.locate(env);
    expect(coords.wezterm).toBeUndefined();
  });

  it('degrades gracefully when wezterm subprocess times out', async () => {
    const env = { WEZTERM_PANE: '12', WEZTERM_UNIX_SOCKET: '/run/x' } as NodeJS.ProcessEnv;
    const exec = mockExec([{ match: /wezterm cli list/, delayMs: 2000 }]);
    const probe = new MuxProbe({ timeoutMs: 100, exec });
    const coords = await probe.locate(env);
    expect(coords.wezterm).toBeUndefined();
  });
});
