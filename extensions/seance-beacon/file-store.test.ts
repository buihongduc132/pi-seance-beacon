import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileStore } from './file-store.js';
import type { BeaconRecord } from './types.js';

describe('FileStore', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'seance-file-store-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function record(overrides: Partial<BeaconRecord> = {}): BeaconRecord {
    return {
      v: 1,
      ts: '2026-07-16T00:00:00.000Z',
      agent: { type: 'pi', session_id: 'sess-abc' },
      cwd: '/home/bhd/project',
      containers: {},
      host: 'host1',
      pid: 1234,
      ...overrides,
    };
  }

  it('atomically upserts a BeaconRecord into live.json', async () => {
    const store = new FileStore({ storeDir: dir, lockTimeoutMs: 200 });
    await store.emit(record({ agent: { type: 'pi', session_id: 'abc123' } }));

    const livePath = join(dir, 'live.json');
    expect(existsSync(livePath)).toBe(true);

    const live = JSON.parse(readFileSync(livePath, 'utf8'));
    expect(live.records).toHaveLength(1);
    expect(live.records[0].agent.session_id).toBe('abc123');
  });

  it('concurrent upserts from many writers never corrupt live.json', async () => {
    const store = new FileStore({ storeDir: dir, lockTimeoutMs: 500 });
    const sessions = Array.from({ length: 20 }, (_, i) =>
      record({
        agent: { type: 'pi', session_id: `sess-${i}` },
        pid: 1000 + i,
      }),
    );

    await Promise.all(sessions.map((r) => store.emit(r)));

    const live = JSON.parse(readFileSync(join(dir, 'live.json'), 'utf8'));
    expect(live.records).toHaveLength(20);
    const ids = new Set(live.records.map((r: BeaconRecord) => r.agent.session_id));
    expect(ids.size).toBe(20);
  });

  it('skips the lock on timeout instead of blocking pi', async () => {
    const store = new FileStore({ storeDir: dir, lockTimeoutMs: 50 });
    const lockPath = join(dir, 'live.json.lock');

    // Hold the lock from this process long enough to force a timeout.
    const { open } = await import('node:fs/promises');
    const handle = await open(lockPath, 'w');
    await handle.write('held');

    const start = Date.now();
    await store.emit(record({ agent: { type: 'pi', session_id: 'timeout-skip' } }));
    const elapsed = Date.now() - start;

    await handle.close();

    // Must not have waited for the long-held lock.
    expect(elapsed).toBeLessThan(200);

    // Record should be spooled (or skipped gracefully) but pi must keep working.
    const livePath = join(dir, 'live.json');
    expect(existsSync(livePath)).toBe(true);
  });
});
