# AGENTS.md — pi-seance-beacon

## What this is

The **capture side** of [seance](https://github.com/buihongduc132/seance), extracted into a standalone pi extension package. It ships the in-agent beacon that reports session id + cwd + tmux/wezterm coords to a store; the reconstruct CLI lives in the seance monorepo.

## Locked decisions (inherited from seance)

- **LD1**: restore is MANUAL; the beacon only captures. (Restore is the CLI's job, not this package.)
- **LD3**: 5–10 sessions per cwd are normal; dedup key is `(host, agent.type, session_id)`, never pane id.
- **LD5**: the beacon/probe/store NEVER throw — failures are warnings. Every code path here must preserve this.

## Architecture boundary (IMPORTANT)

This package is the **capture side only**. The restore-side seams (`MuxAdapter`, `PaneHandle`, `buildRestorePlan`, the CLI, the snapshotter, the plan builders) are intentionally NOT shipped here — they live in seance. If you find yourself wanting to add restore logic to this package, stop: it belongs in seance.

`AgentAdapter` retains its `resumeCommand()`/`sessionExists()` members purely for parity with seance's `PiAgentAdapter` (so the two trees reconcile trivially). The beacon only ever calls `snapshot()`. Do not call `resumeCommand()` from this package — it is dead code here by design.

## File map

```
extensions/seance-beacon/
├── index.ts                 # ENTRY — default export fn(pi); composes FileStore + MuxProbe + activate()
├── seance-beacon.ts         # activate(pi, opts) — hooks pi.on(input|session_start|session_shutdown) + heartbeat
├── pi-agent-adapter.ts      # PiAgentAdapter.snapshot() — extracts session_id from pi's sessionManager
├── mux-probe.ts             # MuxProbe.locate(env) — runs `tmux display-message` + `wezterm cli list`
├── interfaces.ts            # AgentAdapter + TransportAdapter seams (capture subset)
├── types.ts                 # BeaconRecord + AgentIdentity + TmuxCoords + WeztermCoords (the shared contract)
├── file-store.ts            # FileStore — default TransportAdapter (atomic writes, lock, dedup)
├── safe-session-id.ts       # SAFE_SESSION_ID regex + shQuote (single source of truth)
└── *.test.ts                # unit tests + self-containment guard
```

## Self-containment rule

`extensions/seance-beacon/self-containment.test.ts` enforces that NO module imports back into the seance tree (`../../`, `../adapters/`, `../core/`). This is what makes the package installable standalone. If you add a module, that guard runs against it automatically.

## Reconciling with seance

When the seance monorepo changes a capture-side module (`src/core/types.ts`, `src/adapters/{interfaces,pi-agent-adapter,mux-probe,safe-session-id}.ts`, `src/core/file-store.ts`, `src/extensions/seance-beacon/seance-beacon.ts`), mirror the change here and update this package's tests. The `BeaconRecord` schema is additive + versioned — never break it.

## Tests

```bash
npm run typecheck   # tsc --noEmit, strict
npm test            # vitest run — never spawns real tmux/wezterm (mock probes / injected exec)
```

The mux-probe test has a 2s "degrades gracefully on wezterm timeout" case — that's intentional (it asserts LD5 under a real timeout), not a hang.

## Conventions

- pi extension fleet conventions: `@ts-nocheck` on the entry `index.ts` (avoids coupling typecheck to the user-machine pi package path), structural local `PiExtensionAPI` type, default-export factory.
- `package.json` `pi.extensions: ["./extensions"]` is how pi discovers the entry.
- Errors are warned via `pi.logger.warn`, never thrown, never `console.error` to the host TUI.
