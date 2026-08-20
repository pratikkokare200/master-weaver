/**
 * Adapter configuration — binary resolution, timeouts and output caps.
 */

/**
 * The CLI binary. `@brightdata/cli` installs both `brightdata` and the shorter `bdata`; on Windows
 * both are `.cmd` shims, which is why every call goes through a shell.
 *
 * Overridable via `BRIGHTDATA_CLI_BIN` for tests and for pinning an absolute path in production.
 */
export function resolveBin(env: NodeJS.ProcessEnv = process.env): string {
  return env['BRIGHTDATA_CLI_BIN']?.trim() || 'brightdata';
}

/**
 * Per-command hard timeouts (doc 01 §6.2: heal 300s, run 180s, scrape 60s).
 *
 * `create` and `approve` are not specified in doc 01 — the values here are chosen to sit under the
 * CLI's own 600s polling default while leaving room for an AI build, and are flagged for review.
 *
 * These are enforced twice, deliberately:
 *   1. passed to the CLI as `--timeout <seconds>` where it supports one, so it gives up cleanly and
 *      returns a parseable JSON error;
 *   2. as a hard subprocess kill at `timeout + KILL_GRACE_MS`, as a backstop for a wedged process.
 *
 * Raising a limit means raising it here only — both layers read this object.
 */
export const CLI_TIMEOUTS_MS = {
  create: 600_000,
  run: 180_000,
  heal: 300_000,
  approve: 300_000,
  scrape: 60_000,
  budget: 30_000,
} as const;

export type CliCommandName = keyof typeof CLI_TIMEOUTS_MS;

/** Grace between the CLI's own deadline and our tree-kill. */
export const KILL_GRACE_MS = 15_000;

/** Between SIGTERM and SIGKILL on POSIX. Windows goes straight to a forced tree kill. */
export const SIGKILL_GRACE_MS = 3_000;

/**
 * Cap on captured output. A listing run returns every row as JSON, so this is generous — but
 * unbounded buffering of a runaway process is how a worker OOMs.
 */
export const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

/** How much stderr is kept for `healing_attempts.stderr_excerpt`. */
export const STDERR_EXCERPT_CHARS = 2_000;

/**
 * Flags this adapter refuses to send, ever.
 *
 * `--auto-approve` is checked at the spawn boundary as well as being absent from the heal wrapper,
 * because a single missed review turns the product back into a thin CLI wrapper. See the comment in
 * `commands.ts › healScraper` for the full reasoning.
 */
export const FORBIDDEN_FLAGS = ['--auto-approve'] as const;

/**
 * `--auto-save` is forbidden on every command except `scraper approve`.
 *
 * The distinction is the gate, and it is worth stating precisely because the two flags read as a
 * pair and are not one:
 *
 * - On `scraper heal`, `--auto-save` commits the healed template as part of the heal itself. That
 *   skips the review, which is the product.
 * - On `scraper approve`, the review has already happened: the canary was scored against the
 *   collector's contract and cleared `FHS_THRESHOLDS.CANARY_GATE`. `--auto-save` is what makes that
 *   approval take effect.
 *
 * Without it the CLI marks the AI job approved and leaves the collector running the old template,
 * so the fix silently does not land. That is not a safer failure — the episode goes on to score a
 * confirmation run against a scraper that was never changed, and quarantines a repair that was
 * fine. Withholding the flag here buys no safety at all; it just breaks healing.
 *
 * `--auto-approve` is unconditionally forbidden above, so the dangerous combination cannot form
 * regardless of this exception.
 */
export const AUTO_SAVE_FLAG = '--auto-save';

/** The only argv prefix permitted to carry {@link AUTO_SAVE_FLAG}. */
export const AUTO_SAVE_ALLOWED_ON: readonly string[] = ['scraper', 'approve'];
