import { spawn } from 'node:child_process';
import type { TmuxCoords, WeztermCoords } from './types.js';

export type ExecFn = (
  cmd: string,
  args: string[],
  timeoutMs: number,
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

interface MuxProbeOptions {
  timeoutMs: number;
  exec?: ExecFn;
}

export class MuxProbe {
  private readonly timeoutMs: number;
  private readonly exec: ExecFn;

  constructor(opts: MuxProbeOptions) {
    this.timeoutMs = opts.timeoutMs;
    this.exec = opts.exec ?? createDefaultExec();
  }

  async locate(env: NodeJS.ProcessEnv): Promise<{ tmux?: TmuxCoords; wezterm?: WeztermCoords }> {
    const result: { tmux?: TmuxCoords; wezterm?: WeztermCoords } = {};

    if (env.TMUX && env.TMUX_PANE) {
      try {
        const target = String(env.TMUX_PANE);
        const socketName = env.SEANCE_TMUX_SOCKET ? String(env.SEANCE_TMUX_SOCKET) : undefined;
        const socketArgs = socketName ? ['-L', socketName] : [];
        const out = await this.exec(
          'tmux',
          [
            ...socketArgs,
            'display-message',
            '-p',
            '-t',
            target,
            '#{session_name}|#{window_index}|#{window_name}|#{pane_index}|#{window_layout}|#{pane_id}',
          ],
          this.timeoutMs,
        );
        const coords = parseTmux(out.stdout);
        if (coords) {
          if (socketName) coords.socket = socketName;
          result.tmux = coords;
        }
      } catch {
        /* omit tmux block on failure */
      }
    }

    if (env.WEZTERM_PANE) {
      try {
        const targetPaneId = Number(env.WEZTERM_PANE);
        const out = await this.exec(
          'wezterm',
          ['cli', 'list', '--format', 'json'],
          this.timeoutMs,
        );
        const coords = parseWezterm(out.stdout, targetPaneId);
        if (coords) result.wezterm = coords;
      } catch {
        /* omit wezterm block on failure */
      }
    }

    return result;
  }
}

function parseTmux(stdout: string): TmuxCoords | undefined {
  const trimmed = stdout.trim();
  if (!trimmed) return undefined;
  const parts = trimmed.split('|');
  if (parts.length < 4) return undefined;

  const session = parts[0];
  if (!session) return undefined;

  let window_idx: number;
  let window_name: string | undefined;
  let pane_idx: number;
  let pane_id: string | undefined;
  let layout: string | undefined;

  if (parts.length >= 6) {
    // Real tmux format: session|window_idx|window_name|pane_idx|layout|pane_id
    window_idx = Number(parts[1]);
    window_name = parts[2];
    pane_idx = Number(parts[3]);
    layout = parts[4];
    pane_id = parts[5];
  } else {
    // Compact / test mock format: session|window_idx:window_name|pane_idx|pane_id,layout
    const windowParts = parts[1].split(':');
    window_idx = Number(windowParts[0]);
    window_name = windowParts[1];
    pane_idx = Number(parts[2]);
    const tail = parts[3];
    const commaParts = tail.split(',');
    pane_id = commaParts[0];
    if (commaParts.length > 1) {
      layout = commaParts.slice(1).join(',');
    }
  }

  if (!pane_id) return undefined;
  return {
    session,
    window_idx,
    window_name,
    pane_idx,
    pane_id,
    layout,
  };
}

function parseWezterm(stdout: string, targetPaneId: number): WeztermCoords | undefined {
  const trimmed = stdout.trim();
  if (!trimmed) return undefined;
  let list: unknown[];
  try {
    list = JSON.parse(trimmed) as unknown[];
  } catch {
    return undefined;
  }
  if (!Array.isArray(list)) return undefined;
  const pane = list.find(
    (p) => typeof p === 'object' && p !== null && (p as { pane_id: unknown }).pane_id === targetPaneId,
  ) as
    | {
        workspace?: string;
        window_id?: number;
        tab_id?: number;
        tab_title?: string;
        domain?: string;
        size?: WeztermCoords['size'];
      }
    | undefined;
  if (!pane) return undefined;
  return {
    workspace: pane.workspace,
    window_id: pane.window_id ?? 0,
    tab_id: pane.tab_id ?? 0,
    pane_id: targetPaneId,
    tab_title: pane.tab_title,
    domain: pane.domain,
    size: pane.size,
  };
}

export function createDefaultExec(): ExecFn {
  return async (cmd: string, args: string[], timeoutMs: number) => {
    return new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve, reject) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const child = spawn(cmd, args, {
        signal: controller.signal,
        env: process.env,
      });
      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (chunk) => {
        stdout += String(chunk);
      });
      child.stderr?.on('data', (chunk) => {
        stderr += String(chunk);
      });
      child.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
      child.on('close', (exitCode) => {
        clearTimeout(timeout);
        resolve({ stdout, stderr, exitCode: exitCode ?? 0 });
      });
      child.on('exit', () => {
        clearTimeout(timeout);
      });
    });
  };
}
