import { readFileSync, existsSync, renameSync, writeFileSync, openSync, closeSync, unlinkSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import type { BeaconRecord } from './types.js';

export interface FileStoreOptions {
  storeDir: string;
  lockTimeoutMs: number;
}

const LIVE_FILE = 'live.json';

/**
 * Durable file-backed store for the live beacon registry.
 *
 * M1 reconcilation: the unit tests assert the on-disk shape is an envelope
 * `{ records: BeaconRecord[] }`, while the e2e suite writes bare arrays.  We
 * write the envelope and read either shape, so both tests pass.
 */
export class FileStore {
  private readonly storeDir: string;
  private readonly lockTimeoutMs: number;
  private readonly livePath: string;
  private readonly lockPath: string;

  constructor(opts: FileStoreOptions) {
    this.storeDir = opts.storeDir;
    this.lockTimeoutMs = opts.lockTimeoutMs;
    this.livePath = join(opts.storeDir, LIVE_FILE);
    this.lockPath = this.livePath + '.lock';
  }

  async emit(record: BeaconRecord): Promise<void> {
    try {
      const locked = await this.acquireLock();
      if (!locked) {
        console.warn(
          `[seance] file-store: lock acquisition timed out after ${this.lockTimeoutMs}ms; writing without lock (best-effort)`,
        );
      }
      try {
        const records = this.readRaw();
        this.upsert(records, record);
        this.writeAtomic(records);
      } finally {
        if (locked) this.releaseLock();
      }
    } catch (err) {
      console.warn(`[seance] file-store: emit failed: ${(err as Error)?.message ?? err}`);
    }
  }

  load(): BeaconRecord[] {
    try {
      return this.readRaw();
    } catch (err) {
      console.warn(`[seance] file-store: load failed: ${(err as Error)?.message ?? err}`);
      return [];
    }
  }

  async live(): Promise<BeaconRecord[]> {
    return this.load();
  }

  private readRaw(): BeaconRecord[] {
    if (!existsSync(this.livePath)) return [];
    const parsed = JSON.parse(readFileSync(this.livePath, 'utf8'));
    if (Array.isArray(parsed)) return parsed as BeaconRecord[];
    if (parsed && Array.isArray(parsed.records)) return parsed.records as BeaconRecord[];
    return [];
  }

  private upsert(records: BeaconRecord[], record: BeaconRecord): void {
    const idx = records.findIndex(
      (r) =>
        r &&
        r.host === record.host &&
        r.agent &&
        r.agent.type === record.agent.type &&
        r.agent.session_id === record.agent.session_id,
    );
    if (idx >= 0) records[idx] = record;
    else records.push(record);
  }

  private writeAtomic(records: BeaconRecord[]): void {
    const payload = JSON.stringify({ records }, null, 2);
    const tmp = this.livePath + '.tmp';
    writeFileSync(tmp, payload);
    renameSync(tmp, this.livePath);
  }

  private async acquireLock(): Promise<boolean> {
    const deadline = Date.now() + this.lockTimeoutMs;
    for (;;) {
      try {
        const fd = openSync(this.lockPath, 'wx');
        try {
          writeSync(fd, String(process.pid));
        } finally {
          closeSync(fd);
        }
        return true;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== 'EEXIST') {
          // Unexpected error acquiring the lock; proceed without it rather than
          // blocking the agent.
          return false;
        }
      }
      if (Date.now() >= deadline) return false;
      await this.sleep(5);
    }
  }

  private releaseLock(): void {
    try {
      unlinkSync(this.lockPath);
    } catch {
      /* best effort; the lock may be held by someone else */
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
