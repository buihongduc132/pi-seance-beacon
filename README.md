# pi-seance-beacon

> Pi extension beacon — the **capture side** of [seance](https://github.com/buihongduc132/seance).

`seance` resurrects dead terminal layouts **together with the exact agent sessions that lived inside them**. `tmux-resurrect`/`continuum` and `resurrect.wezterm` can rebuild the *container* (panes, cwd, window order); they cannot rebuild the *contents* — the internal session id of a TUI agent (`pi`, `claude`, …) — because that id lives inside the process, invisible to the muxer.

This package is the **in-agent beacon** that closes that gap. Install it as a pi extension and every pi session periodically reports:

- agent `type` + internal `session_id` (+ name, model)
- `cwd`
- the terminal container it lives in: tmux session/window/pane **and/or** wezterm window/tab/pane (both captured when nested)

…to a local file store (or an HTTP collector). When tmux/wezterm dies, the **`seance` CLI** (separate repo) reads the snapshots and rebuilds the layout, relaunching every agent on its exact resume flag (`pi --session-id <id>`, `claude --resume <id>`, …).

This package ships **only the capture side**. The reconstruct CLI, snapshotter, and restore builders live in the `seance` monorepo — they read the exact same `BeaconRecord` store format this package writes.

## Install

As a pi package (recommended):

```bash
pi install https://github.com/buihongduc132/pi-seance-beacon
```

Or add to your pi `settings.json` `packages[]`:

```json
{
  "packages": ["https://github.com/buihongduc132/pi-seance-beacon"]
}
```

Pi clones it into `~/.pi/agent/git/github.com/buihongduc132/pi-seance-beacon/` and auto-loads `extensions/seance-beacon/index.ts` (declared via `pi.extensions` in `package.json`).

## Configure

All runtime config is env-driven (read at extension activation):

| Var | Default | Purpose |
|---|---|---|
| `SEANCE_STORE_DIR` | `~/.local/share/seance` | where `live.json` + snapshots live |
| `SEANCE_BEACON_HEARTBEAT_SEC` | `60` | heartbeat interval between user messages |
| `SEANCE_BEACON_MUX_TIMEOUT_MS` | `2000` | per tmux/wezterm probe timeout |
| `TMUX_PANE` | (auto, inside tmux) | triggers tmux coord capture |
| `WEZTERM_PANE` | (auto, inside wezterm) | triggers wezterm coord capture |

Set these wherever you launch pi (shell rc, tmux environment, etc.).

## Verify

```bash
git clone https://github.com/buihongduc132/pi-seance-beacon
cd pi-seance-beacon
npm install
npm run typecheck   # tsc --noEmit
npm test            # vitest run
```

## Safety invariants

- **Never crashes the host agent** — every beacon/probe/emit failure is caught and warned, never thrown (LD5).
- **Never interpolates an unsafe session id** — ids are validated against `SAFE_SESSION_ID = /^[A-Za-z0-9_-]+$/`.
- **Self-contained** — no imports back into the seance monorepo; installs standalone (enforced by `self-containment.test.ts`).

## Relationship to seance

| Concern | Lives in |
|---|---|
| Beacon (capture) | **this package** (`pi-seance-beacon`) |
| `seance ls` / `snapshots` / `show` / `restore` / `export` CLI | `seance` monorepo |
| Snapshotter, restore builders, executors | `seance` monorepo |
| `BeaconRecord` schema (the shared contract) | both (this package is the source of truth for the capture-side copy) |

The `BeaconRecord` schema is versioned and additive-only; both repos stay in sync because this package is a faithful subset of seance's `src/core/types.ts` + `src/adapters/`.

## License

MIT © buihongduc132
