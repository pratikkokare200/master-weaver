/**
 * Environment parsing, done once at boot and never again.
 *
 * The worker is deployed to a platform where a typo in a dashboard field is the likeliest
 * misconfiguration, so everything is validated up front and the process refuses to start on a bad
 * value rather than failing on the first poll thirty seconds later.
 *
 * Retry and breaker numbers are read from `@weaver/contracts`, not redeclared here. Doc 01 section
 * 3.2: the magic numbers live in one config object, and tuning means editing that file only.
 */

import { CLI_TIMEOUTS_MS } from '@weaver/brightdata';
import { BREAKER_LIMITS } from '@weaver/contracts';

export interface WorkerConfig {
  /** Postgres connection string. Supabase: Settings, Database, Connection string. */
  databaseUrl: string;
  /** TLS for the database connection. `false` for a local socket, an object for anything remote. */
  databaseSsl: false | { rejectUnauthorized: boolean };
  /** Identifies this process in `jobs.claimed_by`. */
  workerId: string;
  /** Queue poll interval. */
  pollIntervalMs: number;
  /**
   * The price cron. 15 minutes.
   *
   * Halved from 30 on Day 3 (audit finding F3). The cron was meant to start on Day 2 and did not
   * start until Day 3 11:48 UTC, so the five-day price history doc 03 section 8 calls demo-critical
   * is now a three-day one. Doubling the sampling rate is the only honest way to recover density --
   * doc 01 section 12.1a forbids seeding synthetic history, and that rule holds.
   *
   * Affordable because it was measured rather than assumed, exactly as section 12.1a requires: one
   * run against the Chaos Lab moved the balance by 0 credits, across 14 consecutive runs. The
   * interval is bounded by politeness to the target, not by budget.
   */
  cronIntervalMs: number;
  /** Fire the cron immediately at boot instead of waiting for the next aligned tick. */
  cronOnBoot: boolean;
  /** A CLAIMED job older than this is assumed to belong to a dead worker and is recovered. */
  claimTimeoutMs: number;
  /** Total claims allowed per job before it is abandoned as FAILED. */
  maxAttempts: number;
  /** Base delay for the transient-failure backoff; doubles per attempt. */
  retryBackoffMs: number;
  /** How long shutdown waits for the in-flight job before forcing an exit. */
  shutdownGraceMs: number;
  /**
   * The doc 01 section 9 global kill switch, expressed positively.
   *
   * Defaults ON, because refusing to heal is not the product. Turning it off leaves the worker
   * running and scoring every scrape while declining to repair anything -- the right shape for an
   * emergency, since a scraper that cannot fix itself is still worth the data it collects.
   */
  healingEnabled: boolean;
  /**
   * Discord webhook. Null disables notification, which is a valid configuration rather than a
   * misconfiguration -- the engine's decisions do not depend on anyone being told about them.
   */
  discordWebhookUrl: string | null;
  /** Base URL of the Observation Deck, for the PENDING_OPERATOR deep link (doc 03 6.3). */
  appBaseUrl: string;
  /** How many recent HEALTHY runs feed the trailing median row count. */
  rowHistoryWindow: number;
  /** Postgres connections to hold open. Supabase caps these per project, so it is a knob. */
  dbPoolMax: number;
  /** Let the CLI fall back to `brightdata login` credentials. Local development only. */
  allowStoredCredentials: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/**
 * First value that is set and not blank.
 *
 * A deploy dashboard submits a cleared field as an empty string rather than removing the variable,
 * so `??` alone would treat "" as a configured value and fail validation on it.
 */
function firstNonEmpty(...values: (string | undefined)[]): string {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return '';
}

function readInt(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    throw new ConfigError(`${name} must be an integer, got ${JSON.stringify(raw)}`);
  }
  if (parsed < min) {
    throw new ConfigError(`${name} must be at least ${min}, got ${parsed}`);
  }
  return parsed;
}

function readBool(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;

  const token = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(token)) return true;
  if (['0', 'false', 'no', 'off'].includes(token)) return false;
  throw new ConfigError(`${name} must be a boolean, got ${JSON.stringify(raw)}`);
}

/** Local Postgres speaks plaintext; anything else is over the internet and gets TLS. */
export function resolveSsl(
  databaseUrl: string,
  env: NodeJS.ProcessEnv,
): false | { rejectUnauthorized: boolean } {
  const explicit = env['DATABASE_SSL'];
  if (explicit !== undefined && explicit.trim() !== '') {
    if (!readBool(env, 'DATABASE_SSL', true)) return false;
  }

  let host = '';
  try {
    host = new URL(databaseUrl).hostname;
  } catch {
    throw new ConfigError(`DATABASE_URL is not a valid connection URL`);
  }

  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '';
  if (isLocal && (explicit === undefined || explicit.trim() === '')) return false;

  // Verifying the chain is the default and Supabase's pooler certificate satisfies it. The escape
  // hatch exists because self-hosted Postgres behind a self-signed certificate is common, and the
  // alternative is people pasting `NODE_TLS_REJECT_UNAUTHORIZED=0` into their deploy, which turns
  // verification off for every connection the process makes rather than just this one.
  return { rejectUnauthorized: readBool(env, 'DATABASE_SSL_REJECT_UNAUTHORIZED', true) };
}

function defaultWorkerId(env: NodeJS.ProcessEnv, hostname: string, pid: number): string {
  const explicit = env['WORKER_ID']?.trim();
  if (explicit) return explicit;

  const suffix = Math.random().toString(36).slice(2, 8);
  return `${hostname}#${pid}#${suffix}`;
}

export interface LoadConfigDeps {
  hostname?: string;
  pid?: number;
}

export function loadConfig(env: NodeJS.ProcessEnv, deps: LoadConfigDeps = {}): WorkerConfig {
  const databaseUrl = firstNonEmpty(env['DATABASE_URL'], env['SUPABASE_DB_URL']);
  if (databaseUrl === '') {
    throw new ConfigError(
      'DATABASE_URL is not set. The worker connects to Supabase Postgres directly — ' +
        'the queue claim needs FOR UPDATE SKIP LOCKED, which PostgREST cannot express.',
    );
  }

  const allowStoredCredentials = readBool(env, 'BRIGHTDATA_ALLOW_STORED_CREDENTIALS', false);
  if (!allowStoredCredentials && (env['BRIGHTDATA_API_KEY'] ?? '').trim() === '') {
    throw new ConfigError(
      'BRIGHTDATA_API_KEY is not set. Doc 01 section 6.2 requires the key to come from the ' +
        'environment, never an interactive login on the server. Set ' +
        'BRIGHTDATA_ALLOW_STORED_CREDENTIALS=true for local development only.',
    );
  }

  const logLevel = (firstNonEmpty(env['LOG_LEVEL']) || 'info').toLowerCase();
  if (!['debug', 'info', 'warn', 'error'].includes(logLevel)) {
    throw new ConfigError(`LOG_LEVEL must be one of debug|info|warn|error, got ${JSON.stringify(logLevel)}`);
  }

  return {
    databaseUrl,
    databaseSsl: resolveSsl(databaseUrl, env),
    workerId: defaultWorkerId(env, deps.hostname ?? 'worker', deps.pid ?? 0),
    pollIntervalMs: readInt(env, 'WORKER_POLL_INTERVAL_MS', 10_000, 250),
    cronIntervalMs: readInt(env, 'WORKER_CRON_INTERVAL_MS', 15 * 60_000, 60_000),
    cronOnBoot: readBool(env, 'WORKER_CRON_ON_BOOT', false),
    healingEnabled: readBool(env, 'WORKER_HEALING_ENABLED', true),
    discordWebhookUrl: (env.DISCORD_WEBHOOK_URL ?? '').trim() || null,
    appBaseUrl: (env.APP_BASE_URL ?? '').trim() || 'http://localhost:3000',
    claimTimeoutMs: readInt(env, 'WORKER_CLAIM_TIMEOUT_MS', 10 * 60_000, 60_000),
    // TRANSIENT_RETRIES is the number of *retries*, so the total number of claims is one more.
    maxAttempts: readInt(env, 'WORKER_MAX_ATTEMPTS', BREAKER_LIMITS.TRANSIENT_RETRIES + 1, 1),
    retryBackoffMs: readInt(env, 'WORKER_RETRY_BACKOFF_MS', 30_000, 1_000),
    // The CLI kills its own run at 180s plus a 15s grace, so this only has to outlast that.
    shutdownGraceMs: readInt(env, 'WORKER_SHUTDOWN_GRACE_MS', CLI_TIMEOUTS_MS.run + 60_000, 1_000),
    rowHistoryWindow: readInt(env, 'WORKER_ROW_HISTORY_WINDOW', 5, 1),
    // The worker runs one job at a time; the cron and the reaper are the only other users, so four
    // is headroom rather than throughput. Lower it when the project is near its connection cap.
    dbPoolMax: readInt(env, 'WORKER_DB_POOL_MAX', 4, 1),
    allowStoredCredentials,
    logLevel: logLevel as WorkerConfig['logLevel'],
  };
}
