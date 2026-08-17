/**
 * @weaver/brightdata — the Bright Data CLI subprocess adapter.
 *
 * The CLI is CLI-only (no Node SDK), so every call to Bright Data in this product goes through this
 * package. It owns spawning, quoting, timeouts, process-tree kills, JSON parsing and secret
 * redaction, so that nothing above it has to think about subprocesses.
 *
 * It never passes `--auto-approve`. See `commands.ts › healScraper`.
 */

export {
  createScraper,
  runScraper,
  healScraper,
  approveHeal,
  rejectHeal,
  probeUrl,
  getBudget,
  createBrightDataClient,
  SCRAPE_FORMATS,
  BUDGET_SCOPES,
} from './commands.js';
export type {
  CommandOptions,
  CreateScraperInput,
  RunScraperInput,
  HealScraperInput,
  ApproveHealInput,
  ProbeUrlInput,
  ScrapeFormat,
  BudgetScope,
  BrightDataClient,
} from './commands.js';

export { runCli, parseCliJson, stripAnsi, assertNoForbiddenFlags } from './spawn.js';
export type { RunCliOptions, CliLogger, CliLogEvent } from './spawn.js';

export {
  BrightDataCliError,
  AWAITING_APPROVAL_STATUS,
  isAwaitingApproval,
  extractCanarySample,
} from './types.js';
export type {
  CliErrorKind,
  CliResult,
  CreateResponse,
  RunResponse,
  HealResponse,
  ApproveResponse,
  ScrapeResponse,
  BudgetResponse,
} from './types.js';

export {
  CLI_TIMEOUTS_MS,
  KILL_GRACE_MS,
  MAX_OUTPUT_BYTES,
  STDERR_EXCERPT_CHARS,
  FORBIDDEN_FLAGS,
  resolveBin,
} from './config.js';
export type { CliCommandName } from './config.js';

export { quoteArg, quoteArgv, quoteWindowsArg, quotePosixArg } from './quote.js';
export { REDACTED, redactText, redactArgv, formatArgvRedacted, collectSecrets } from './redact.js';
