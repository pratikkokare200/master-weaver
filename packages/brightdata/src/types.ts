/**
 * CLI response shapes and the adapter's result/error types.
 *
 * The envelopes below were verified against `@brightdata/cli@0.3.4` output captured during the
 * Day-1 verification run (`heal_response.json`, `run_v1.json`, `run_v2_broken.json`). Fields the CLI
 * does not always emit are optional; `raw` on {@link CliResult} always carries the parsed payload so
 * nothing is lost to a narrow type.
 */

import type { ScrapedRow } from '@weaver/contracts';

/** Why a CLI call failed. Drives the state machine's response (doc 01 §11). */
export type CliErrorKind =
  /** The process could not be started at all. */
  | 'spawn'
  /** Our deadline expired and the process tree was killed. Transient — retry. */
  | 'timeout'
  /** The process ran and exited non-zero. */
  | 'exit'
  /** Exit 0 but the output was not parseable JSON. */
  | 'parse'
  /** Credentials missing or rejected. Quarantine immediately — this is not a heal case. */
  | 'auth'
  /** A caller tried to send a flag this adapter refuses to send. */
  | 'forbidden_flag'
  /** Caller-side argument validation failed before anything was spawned. */
  | 'validation';

export class BrightDataCliError extends Error {
  readonly kind: CliErrorKind;
  readonly exitCode: number | null;
  readonly argvRedacted: string;
  readonly stderrExcerpt: string;
  readonly durationMs: number;

  constructor(
    kind: CliErrorKind,
    message: string,
    details: {
      exitCode?: number | null;
      argvRedacted?: string;
      stderrExcerpt?: string;
      durationMs?: number;
      cause?: unknown;
    } = {},
  ) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = 'BrightDataCliError';
    this.kind = kind;
    this.exitCode = details.exitCode ?? null;
    this.argvRedacted = details.argvRedacted ?? '';
    this.stderrExcerpt = details.stderrExcerpt ?? '';
    this.durationMs = details.durationMs ?? 0;
  }

  /** Timeouts are worth retrying; auth failures and forbidden flags never are. */
  get retryable(): boolean {
    return this.kind === 'timeout' || this.kind === 'spawn';
  }
}

/**
 * The outcome of one CLI invocation.
 *
 * Non-throwing by design: the worker writes a ledger row for every attempt including the failures,
 * so a result object is easier to persist than an exception. `cli_argv_redacted` and
 * `stderr_excerpt` map straight onto their `healing_attempts` columns.
 */
export interface CliResult<T> {
  ok: boolean;
  /** Parsed payload, or null when the call failed or produced no JSON. */
  data: T | null;
  /** Whatever JSON was parsed, untyped — an escape hatch when the envelope gains a field. */
  raw: unknown;
  /** e.g. `scraper heal`. For logging and metrics. */
  command: string;
  /** Full command line, API key redacted. Persist this. */
  argvRedacted: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  durationMs: number;
  /** Captured separately, as required — the CLI writes data to stdout and diagnostics to stderr. */
  stdout: string;
  stderr: string;
  /** First {@link STDERR_EXCERPT_CHARS} characters of stderr, redacted. Persist this. */
  stderrExcerpt: string;
  /** True if output hit {@link MAX_OUTPUT_BYTES} and was truncated. */
  truncated: boolean;
  error: BrightDataCliError | null;
}

// ---------------------------------------------------------------------------------------------
// Command envelopes
// ---------------------------------------------------------------------------------------------

/** `scraper create` — v0.3 envelope. */
export interface CreateResponse {
  collector_id: string;
  name?: string;
  status?: string;
  view_url?: string;
  next_step?: string;
  preview_result?: ScrapedRow[];
}

/**
 * `scraper run` returns a bare JSON array of rows — no envelope.
 *
 * Verified shape: each row carries the contract fields plus an `input: { url }` echo, and `price`
 * comes back as `{ value, currency, symbol }` rather than a scalar.
 */
export type RunResponse = ScrapedRow[];

/** The status a heal reports when it stops at the approval gate — the state we build on. */
export const AWAITING_APPROVAL_STATUS = 'awaiting_approval';

/**
 * `scraper heal` — v0.3 envelope, verified against a real gated heal.
 *
 * `preview_result` is the canary sample: the proposed fix's output, which we score against the same
 * contract that caught the break. Its presence is the load-bearing assumption of the whole product
 * (doc 01 §12.1) and was confirmed during Day-1 verification.
 */
export interface HealResponse {
  collector_id: string;
  /** `awaiting_approval` on the happy path. Anything else is a quarantine case (doc 01 §11). */
  status: string;
  /** The diagnosis we sent, echoed back. */
  prompt?: string;
  view_url?: string;
  /** The CLI's own suggested next command. Informational — we decide, not it. */
  next_step?: string;
  completed_steps?: string[];
  /** The canary sample. */
  preview_result?: ScrapedRow[];
  diff_summary?: string;
}

/** `scraper approve` and `scraper approve --reject` share an envelope. */
export interface ApproveResponse {
  collector_id: string;
  status?: string;
  view_url?: string;
  next_step?: string;
  preview_result?: ScrapedRow[];
}

/** `scrape <url> --json` — the transient-vs-structural probe (doc 01 §4.3). */
export interface ScrapeResponse {
  url?: string;
  status_code?: number;
  /** Page body in the requested format; markdown by default. */
  content?: string;
  [key: string]: unknown;
}

/** `budget --json`. Field names vary by account shape, so this stays permissive. */
export interface BudgetResponse {
  balance?: number;
  currency?: string;
  [key: string]: unknown;
}

/** True when a heal stopped at the approval gate, as designed. */
export function isAwaitingApproval(response: HealResponse | null): boolean {
  return response?.status === AWAITING_APPROVAL_STATUS;
}

/**
 * Pull the canary sample out of a heal response.
 *
 * Returns `[]` when absent or malformed — doc 01 §11 requires an empty/malformed canary be treated
 * as FHS 0 and rejected, never as "no data, assume fine".
 */
export function extractCanarySample(response: HealResponse | null): ScrapedRow[] {
  const preview = response?.preview_result;
  return Array.isArray(preview) ? preview : [];
}
