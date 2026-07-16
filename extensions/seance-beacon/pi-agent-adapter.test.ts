import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PiAgentAdapter } from './pi-agent-adapter.js';
import type { AgentIdentity } from './types.js';

interface PiExtensionContext {
  cwd: string;
  sessionManager: { getSessionFile(): string };
  meta?: { name?: string; model?: string };
}

describe('PiAgentAdapter', () => {
  let adapter: PiAgentAdapter;
  let tmpDir: string;

  beforeEach(() => {
    adapter = new PiAgentAdapter();
    tmpDir = mkdtempSync(join(tmpdir(), 'seance-pi-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('snapshot()', () => {
    it('extracts session_id from the session file path', () => {
      const sessionFile = join(tmpDir, 'ses_abc-123-xyz.jsonl');
      const ctx: PiExtensionContext = {
        cwd: '/home/bhd/project',
        sessionManager: { getSessionFile: () => sessionFile },
        meta: { name: 'pi', model: 'default' },
      };
      const id = adapter.snapshot(ctx);
      expect(id).not.toBeNull();
      expect(id?.type).toBe('pi');
      expect(id?.session_id).toBe('abc-123-xyz');
      expect(id?.session_file).toBe(sessionFile);
    });

    it('returns null for ephemeral sessions (retry later)', () => {
      const ctx: PiExtensionContext = {
        cwd: '/home/bhd/project',
        sessionManager: { getSessionFile: () => join(tmpDir, 'ses_ephemeral.jsonl') },
      };
      expect(adapter.snapshot(ctx)).toBeNull();
    });
  });

  describe('resumeCommand()', () => {
    it('emits the pi --session-id resume invocation for the cwd [LD2]', () => {
      const id: AgentIdentity = { type: 'pi', session_id: 'abc-123' };
      const cmd = adapter.resumeCommand(id, '/home/bhd/project');
      expect(cmd).toBe('cd "/home/bhd/project" && pi --session-id abc-123');
    });

    it('escapes session ids that fail the safe-pattern check [injection safety]', () => {
      const id: AgentIdentity = { type: 'pi', session_id: 'a; rm -rf /' };
      const cmd = adapter.resumeCommand(id, '/home/bhd/project');
      // Unsafe ids must never be interpolated raw into the command.
      expect(cmd).not.toContain('rm -rf');
    });
  });

  describe('sessionExists()', () => {
    it('returns true when the session file exists on disk', async () => {
      const sessionFile = join(tmpDir, 'ses_abc123.jsonl');
      writeFileSync(sessionFile, '{"x":1}\n');
      const id: AgentIdentity = {
        type: 'pi',
        session_id: 'abc123',
        session_file: sessionFile,
      };
      await expect(adapter.sessionExists(id)).resolves.toBe(true);
    });

    it('returns false when the session file is missing', async () => {
      const id: AgentIdentity = {
        type: 'pi',
        session_id: 'abc123',
        session_file: join(tmpDir, 'nope.jsonl'),
      };
      await expect(adapter.sessionExists(id)).resolves.toBe(false);
    });
  });
});
