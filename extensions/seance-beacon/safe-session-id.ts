/**
 * Shared session-id safety contract.
 *
 * Agent session ids are interpolated into shell resume commands (send-keys).
 * They MUST be restricted to a safe charset to prevent command injection.
 * Anything outside this set must be refused (fail loud), never silently
 * coerced or stripped.
 *
 * Single source of truth — imported by every adapter + the plan builder.
 * Duplicating this regex was a DRY/security hazard (F2, compliance audit):
 * a divergent edit in one copy would silently open an injection hole.
 */
export const SAFE_SESSION_ID = /^[A-Za-z0-9_-]+$/;

/** Shell-quote a value for safe interpolation into a shell command (double-quote wrap
 *  with embedded quote/backslash escaping). Used for cwd/window-name interpolation
 *  inside resume commands + tmux structural commands, so paths with spaces or shell
 *  metacharacters are protected at the pane-shell layer. */
export function shQuote(s: string): string {
  return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}
