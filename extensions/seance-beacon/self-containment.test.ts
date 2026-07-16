import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, extname } from 'node:path';

/**
 * Self-containment guard for the standalone pi-seance-beacon package.
 *
 * This package is the CAPTURE SIDE of seance, extracted so it can be installed
 * as a git-sourced pi extension WITHOUT pulling in the seance monorepo. Every
 * module it ships must resolve its imports locally (./) or from node builtins
 * or from pi peer deps — never back into the seance source tree (../.., adapters/,
 * core/). A stray `../../adapters/...` import would make the package fail to load
 * standalone and is the exact regression this test prevents.
 */
describe('pi-seance-beacon package self-containment (G6)', () => {
  const dir = __dirname;

  it('ships at least the required capture-side modules', () => {
    const required = [
      'index.ts',
      'seance-beacon.ts',
      'pi-agent-adapter.ts',
      'mux-probe.ts',
      'interfaces.ts',
      'types.ts',
      'file-store.ts',
      'safe-session-id.ts',
    ];
    const present = readdirSync(dir);
    for (const f of required) {
      expect(present, `missing required module ${f}`).toContain(f);
    }
  });

  it('never imports back into the seance monorepo (no ../../, no ../adapters, no ../core)', () => {
    const files = readdirSync(dir).filter((f) => extname(f) === '.ts' && !f.endsWith('.test.ts'));
    expect(files.length).toBeGreaterThan(0);
    const forbidden = /from\s+['"](\.\.\/\.\.\/|\.\.\/(?:adapters|core|cli|extensions)\/)/;
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(join(dir, f), 'utf8');
      if (forbidden.test(src)) offenders.push(f);
    }
    expect(offenders, `these modules escape the package boundary: ${offenders.join(', ')}`).toEqual([]);
  });

  it('seance-beacon.ts activate() is exported (the entry wires it)', () => {
    const src = readFileSync(join(dir, 'seance-beacon.ts'), 'utf8');
    expect(src).toMatch(/export\s+async\s+function\s+activate/);
  });

  it('index.ts has a default-export entry function pi can load', () => {
    const src = readFileSync(join(dir, 'index.ts'), 'utf8');
    expect(src).toMatch(/export\s+default\s+function/);
    // entry wires the concrete FileStore + MuxProbe (capture-side composition root)
    expect(src).toMatch(/FileStore/);
    expect(src).toMatch(/activate/);
  });
});
