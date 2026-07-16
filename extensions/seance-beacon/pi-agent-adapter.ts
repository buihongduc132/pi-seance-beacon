import { basename } from 'node:path';
import { access } from 'node:fs/promises';
import type { AgentIdentity } from './types.js';
import { SAFE_SESSION_ID, shQuote } from './safe-session-id.js';

export class PiAgentAdapter {
  readonly type = 'pi' as const;

  snapshot(ctx: unknown): AgentIdentity | null {
    try {
      const c = ctx as {
        sessionManager?: { getSessionFile?: () => string | null | undefined };
        sessionName?: string;
        meta?: { name?: string; model?: string };
      };
      const sessionFile = c?.sessionManager?.getSessionFile?.();
      if (sessionFile == null) return null;
      if (sessionFile.includes('ephemeral')) return null;

      const file = basename(sessionFile);
      const noExt = file.replace(/\.jsonl$/, '');
      const uuid = noExt.substring(noExt.lastIndexOf('_') + 1);
      if (!SAFE_SESSION_ID.test(uuid)) return null;

      return {
        type: 'pi',
        session_id: uuid,
        session_file: sessionFile,
        name: c?.sessionName ?? c?.meta?.name,
        model: c?.meta?.model,
      };
    } catch {
      return null;
    }
  }

  resumeCommand(id: AgentIdentity, cwd: string): string {
    if (!SAFE_SESSION_ID.test(id.session_id)) {
      return 'echo "unsafe session id"';
    }
    return `cd ${shQuote(cwd)} && pi --session-id ${id.session_id}`;
  }

  async sessionExists(id: AgentIdentity): Promise<boolean> {
    if (!id.session_file) return false;
    try {
      await access(id.session_file);
      return true;
    } catch {
      return false;
    }
  }
}
