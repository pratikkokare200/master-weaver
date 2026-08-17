/**
 * Typed wrappers for the Bright Data CLI surface we use.
 *
 * Command surface verified against `@brightdata/cli@0.3.4`:
 *
 *   scraper create <url> <description>   collector creation from natural language
 *   scraper run <collector_id> [url]     scheduled + manual runs, golden-set confirmation
 *   scraper heal <collector_id> <prompt> repair proposal — never with --auto-approve
 *   scraper approve <collector_id>       commit a fix that cleared the canary gate
 *   scraper approve <id> --reject        discard a fix that did not — the primary rollback
 *   scrape <url>                         transient-vs-structural probe (doc 01 §4.3)
 *   budget                               credit accounting per episode (doc 01 §9)
 *
 * Every wrapper passes `--json`. None of them throw for a CLI-level failure — that comes back as a
 * `CliResult` with `ok: false`, because the worker writes a ledger row for failures too. They throw
 * only for caller-side mistakes caught before spawning: bad arguments, or a forbidden flag.
 */

import { CLI_INPUT_LIMITS } from '@weaver/contracts';

import { CLI_TIMEOUTS_MS } from './config.js';
import { type CliLogger, runCli } from './spawn.js';
import {
  type ApproveResponse,
  BrightDataCliError,
  type BudgetResponse,
  type CliResult,
  type CreateResponse,
  type HealResponse,
  type RunResponse,
  type ScrapeResponse,
} from './types.js';

/** Options every wrapper accepts. */
export interface CommandOptions {
  /** Overrides the per-command default from `CLI_TIMEOUTS_MS`. */
  timeoutMs?: number;
  bin?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  logger?: CliLogger;
  /**
   * Allow the CLI to fall back to credentials stored by `brightdata login`.
   *
   * Off by default: doc 01 §6.2 requires the key to come from the environment, and a server that
   * silently depends on an interactive login is a server that breaks on a fresh deploy. Turn this
   * on only for local development.
   */
  allowStoredCredentials?: boolean;
}

const JSON_FLAG = '--json';

function assertApiKey(options: CommandOptions): void {
  if (options.allowStoredCredentials) return;
  const env = options.env ?? process.env;
  const key = env['BRIGHTDATA_API_KEY'];
  if (typeof key !== 'string' || key.trim() === '') {
    throw new BrightDataCliError(
      'auth',
      'BRIGHTDATA_API_KEY is not set. The CLI must authenticate from the environment — never an ' +
        'interactive login on the server (doc 01 §6.2). Pass allowStoredCredentials for local dev.',
    );
  }
}

function assertNonEmpty(value: string, field: string): void {
  if (value.trim() === '') {
    throw new BrightDataCliError('validation', `${field} must not be empty`);
  }
}

/** Seconds, for the CLI's own `--timeout` flag. */
function toSeconds(ms: number): string {
  return String(Math.max(1, Math.floor(ms / 1000)));
}

// ---------------------------------------------------------------------------------------------
// scraper create
// ---------------------------------------------------------------------------------------------

export interface CreateScraperInput {
  /** Target URL the collector is built against. */
  url: string;
  /** Natural-language description of the data to extract. CLI limit: 500 chars. */
  description: string;
  /** Template name. Defaults to the CLI's `cli-scraper-<timestamp>`. */
  name?: string;
}

/** `brightdata scraper create <url> <description> --json` */
export async function createScraper(
  input: CreateScraperInput,
  options: CommandOptions = {},
): Promise<CliResult<CreateResponse>> {
  assertApiKey(options);
  assertNonEmpty(input.url, 'url');
  assertNonEmpty(input.description, 'description');

  if (input.description.length > CLI_INPUT_LIMITS.INTENT_CHARS) {
    throw new BrightDataCliError(
      'validation',
      `description is ${input.description.length} chars; the CLI caps it at ${CLI_INPUT_LIMITS.INTENT_CHARS}`,
    );
  }

  const timeoutMs = options.timeoutMs ?? CLI_TIMEOUTS_MS.create;
  const argv = ['scraper', 'create', input.url, input.description];
  if (input.name) argv.push('--name', input.name);
  argv.push('--timeout', toSeconds(timeoutMs), JSON_FLAG);

  return runCli<CreateResponse>({ ...options, argv, command: 'scraper create', timeoutMs });
}

// ---------------------------------------------------------------------------------------------
// scraper run
// ---------------------------------------------------------------------------------------------

export interface RunScraperInput {
  collectorId: string;
  /** Single target. Ignored when `urls` is supplied. */
  url?: string;
  /**
   * Batch targets — used for the golden-set confirmation run, which scrapes every pinned URL in
   * one call. Sent as the CLI's comma-separated `--urls`.
   */
  urls?: string[];
  /** Human-readable job name, surfaced in the Bright Data console. */
  name?: string;
}

/** `brightdata scraper run <collector_id> [url] --json` — returns a bare array of rows. */
export async function runScraper(
  input: RunScraperInput,
  options: CommandOptions = {},
): Promise<CliResult<RunResponse>> {
  assertApiKey(options);
  assertNonEmpty(input.collectorId, 'collectorId');

  const hasBatch = Array.isArray(input.urls) && input.urls.length > 0;
  if (!hasBatch && !input.url) {
    throw new BrightDataCliError('validation', 'runScraper requires either url or a non-empty urls[]');
  }

  const timeoutMs = options.timeoutMs ?? CLI_TIMEOUTS_MS.run;
  const argv = ['scraper', 'run', input.collectorId];

  if (hasBatch) {
    // Commas are cmd.exe metacharacters; the quoting layer keeps the list intact.
    argv.push('--urls', input.urls!.join(','));
  } else if (input.url) {
    argv.push(input.url);
  }

  if (input.name) argv.push('--name', input.name);
  argv.push('--timeout', toSeconds(timeoutMs), JSON_FLAG);

  return runCli<RunResponse>({ ...options, argv, command: 'scraper run', timeoutMs });
}

// ---------------------------------------------------------------------------------------------
// scraper heal
// ---------------------------------------------------------------------------------------------

export interface HealScraperInput {
  collectorId: string;
  /** The plain-English diagnosis. CLI limit: 1000 chars. Persisted verbatim to the ledger. */
  diagnosis: string;
  /** Verify target woven into the CLI's next-step hint. Not sent to the heal call itself. */
  url?: string;
}

/**
 * `brightdata scraper heal <collector_id> "<diagnosis>" --url <url> --json`
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *  HARD RULE: WE NEVER PASS `--auto-approve`. NOT AS A DEFAULT, NOT AS AN OPTION, NOT EVER.
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * The flag exists. `@brightdata/cli` documents it as: "When the heal hits the approval gate,
 * approve it automatically and poll through to done." Passing it would delete a step and make this
 * function shorter. Do not add it. Here is exactly why:
 *
 * 1. IT IS THE ENTIRE PRODUCT. Bright Data already ships self-healing. What Master Weaver adds is
 *    the refusal to trust it blindly: `heal` stops at an approval gate and hands back a canary
 *    sample of the proposed fix, and we stand at that gate. We score that canary against the same
 *    contract that caught the break, at a stricter threshold (FHS ≥ 0.90), and only then approve.
 *    With `--auto-approve` this package becomes a thin CLI wrapper and the product has no thesis.
 *
 * 2. THE FLAG SURRENDERS THE EVIDENCE. Auto-approving polls straight through to "done", so the
 *    canary sample we need to score is consumed by the CLI instead of returned to us. There is
 *    nothing left to validate, nothing to write to `healing_attempts.canary_sample`, and no score
 *    to justify the decision in the ledger. The audit trail collapses to "it changed something".
 *
 * 3. THERE IS NO UNDO. Healing rewrites the collector's extraction template *in place*. Bright Data
 *    exposes no version history and no rollback, so `scraper approve --reject` — refusing the fix
 *    while it is still at the gate — is the only true rollback that exists. Once a bad fix is
 *    committed, our only remaining option is to heal forward again, which costs credits and may
 *    make things worse. That constraint is why the gate is load-bearing rather than decorative.
 *
 * 4. A BAD FIX IS PLAUSIBLE, NOT OBVIOUS. The failure mode is not "the heal errors". It is a fix
 *    that extracts *something* — the shipping cost instead of the price, the breadcrumb instead of
 *    the product name — and looks fine until someone reads the data. That is precisely what the
 *    canary score catches and what auto-approval would commit silently.
 *
 * See ADR-003 and ADR-005, doc 01 §1/§6.1/§8, doc 03 §2.2. `--auto-approve` and `--auto-save` are
 * additionally rejected at the spawn boundary by `assertNoForbiddenFlags`, so hand-rolling an argv
 * will not get around this either. If you are here to add it, change the ADRs first.
 */
export async function healScraper(
  input: HealScraperInput,
  options: CommandOptions = {},
): Promise<CliResult<HealResponse>> {
  assertApiKey(options);
  assertNonEmpty(input.collectorId, 'collectorId');
  assertNonEmpty(input.diagnosis, 'diagnosis');

  if (input.diagnosis.length > CLI_INPUT_LIMITS.DIAGNOSIS_CHARS) {
    // Truncation is the diagnosis builder's job — it drops page context first, then the field list
    // (doc 01 §11). Silently trimming here would corrupt the meaning of the repair request.
    throw new BrightDataCliError(
      'validation',
      `diagnosis is ${input.diagnosis.length} chars; the CLI caps it at ` +
        `${CLI_INPUT_LIMITS.DIAGNOSIS_CHARS}. Truncate in the diagnosis builder, not here.`,
    );
  }

  const timeoutMs = options.timeoutMs ?? CLI_TIMEOUTS_MS.heal;
  const argv = ['scraper', 'heal', input.collectorId, input.diagnosis];
  if (input.url) argv.push('--url', input.url);
  argv.push('--timeout', toSeconds(timeoutMs), JSON_FLAG);

  // ── `--auto-approve` would go here. It does not. See the block comment above. ──

  return runCli<HealResponse>({ ...options, argv, command: 'scraper heal', timeoutMs });
}

// ---------------------------------------------------------------------------------------------
// scraper approve / approve --reject
// ---------------------------------------------------------------------------------------------

export interface ApproveHealInput {
  collectorId: string;
  /** Verify target woven into the next-step hint on success. */
  url?: string;
}

/**
 * `brightdata scraper approve <collector_id> --url <url> --json`
 *
 * Only ever called after a canary sample has scored ≥ `FHS_THRESHOLDS.CANARY_GATE` against the
 * collector's contract. This commits the fix in place and cannot be undone — the golden-set
 * confirmation run that follows is what decides RESTORED vs QUARANTINED.
 */
export async function approveHeal(
  input: ApproveHealInput,
  options: CommandOptions = {},
): Promise<CliResult<ApproveResponse>> {
  assertApiKey(options);
  assertNonEmpty(input.collectorId, 'collectorId');

  const timeoutMs = options.timeoutMs ?? CLI_TIMEOUTS_MS.approve;
  const argv = ['scraper', 'approve', input.collectorId];
  if (input.url) argv.push('--url', input.url);
  argv.push('--timeout', toSeconds(timeoutMs), JSON_FLAG);

  return runCli<ApproveResponse>({ ...options, argv, command: 'scraper approve', timeoutMs });
}

/**
 * `brightdata scraper approve <collector_id> --reject --json`
 *
 * The primary rollback. Because healing rewrites the collector in place with no version history,
 * rejecting at the gate is the only point at which a bad fix can still be discarded cleanly.
 */
export async function rejectHeal(
  input: { collectorId: string },
  options: CommandOptions = {},
): Promise<CliResult<ApproveResponse>> {
  assertApiKey(options);
  assertNonEmpty(input.collectorId, 'collectorId');

  const timeoutMs = options.timeoutMs ?? CLI_TIMEOUTS_MS.approve;
  const argv = [
    'scraper',
    'approve',
    input.collectorId,
    '--reject',
    '--timeout',
    toSeconds(timeoutMs),
    JSON_FLAG,
  ];

  return runCli<ApproveResponse>({
    ...options,
    argv,
    command: 'scraper approve --reject',
    timeoutMs,
  });
}

// ---------------------------------------------------------------------------------------------
// scrape — the probe
// ---------------------------------------------------------------------------------------------

export const SCRAPE_FORMATS = ['markdown', 'html', 'screenshot', 'json'] as const;
export type ScrapeFormat = (typeof SCRAPE_FORMATS)[number];

export interface ProbeUrlInput {
  url: string;
  /** Defaults to `markdown` — cheap, and enough to tell "page is alive" from "page changed". */
  format?: ScrapeFormat;
  /** ISO country code for geo-targeting. */
  country?: string;
}

/**
 * `brightdata scrape <url> --json` — the transient-vs-structural probe (doc 01 §4.3).
 *
 * A cheap raw fetch with no extraction. If a run returns zero rows, this answers the only question
 * that matters: is the page fine and our extraction broken (structural → heal), or is the site down
 * or blocking us (transient → retry, then quarantine)? Healing a scraper because a site was down
 * would burn credits rewriting a template that was never wrong.
 *
 * Also supplies the page context the diagnosis builder quotes from (doc 01 §4.4).
 */
export async function probeUrl(
  input: ProbeUrlInput,
  options: CommandOptions = {},
): Promise<CliResult<ScrapeResponse>> {
  assertApiKey(options);
  assertNonEmpty(input.url, 'url');

  const timeoutMs = options.timeoutMs ?? CLI_TIMEOUTS_MS.scrape;
  const argv = ['scrape', input.url];
  if (input.format) argv.push('--format', input.format);
  if (input.country) argv.push('--country', input.country);
  argv.push(JSON_FLAG); // `scrape` has no --timeout flag; our subprocess deadline covers it.

  return runCli<ScrapeResponse>({ ...options, argv, command: 'scrape', timeoutMs });
}

// ---------------------------------------------------------------------------------------------
// budget
// ---------------------------------------------------------------------------------------------

export const BUDGET_SCOPES = ['summary', 'balance', 'zones'] as const;
export type BudgetScope = (typeof BUDGET_SCOPES)[number];

/**
 * `brightdata budget --json`
 *
 * Polled before each episode and after each run so `credits_before` / `credits_after` can be
 * differenced into `healing_episodes.credits_spent` (doc 01 §9). "This repair cost 4 credits and
 * 38 seconds" is a demo line, so the numbers have to be real.
 */
export async function getBudget(
  input: { scope?: BudgetScope } = {},
  options: CommandOptions = {},
): Promise<CliResult<BudgetResponse>> {
  assertApiKey(options);

  const timeoutMs = options.timeoutMs ?? CLI_TIMEOUTS_MS.budget;
  const argv = ['budget'];
  if (input.scope && input.scope !== 'summary') argv.push(input.scope);
  argv.push(JSON_FLAG);

  return runCli<BudgetResponse>({ ...options, argv, command: 'budget', timeoutMs });
}

// ---------------------------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------------------------

/**
 * Bind shared options once — the worker sets `env` and `logger` at startup and then calls the
 * wrappers without repeating them.
 */
export function createBrightDataClient(defaults: CommandOptions = {}) {
  const merge = (options?: CommandOptions): CommandOptions => ({ ...defaults, ...options });

  return {
    createScraper: (input: CreateScraperInput, options?: CommandOptions) =>
      createScraper(input, merge(options)),
    runScraper: (input: RunScraperInput, options?: CommandOptions) =>
      runScraper(input, merge(options)),
    healScraper: (input: HealScraperInput, options?: CommandOptions) =>
      healScraper(input, merge(options)),
    approveHeal: (input: ApproveHealInput, options?: CommandOptions) =>
      approveHeal(input, merge(options)),
    rejectHeal: (input: { collectorId: string }, options?: CommandOptions) =>
      rejectHeal(input, merge(options)),
    probeUrl: (input: ProbeUrlInput, options?: CommandOptions) => probeUrl(input, merge(options)),
    getBudget: (input?: { scope?: BudgetScope }, options?: CommandOptions) =>
      getBudget(input ?? {}, merge(options)),
  };
}

export type BrightDataClient = ReturnType<typeof createBrightDataClient>;
