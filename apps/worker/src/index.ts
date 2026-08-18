/**
 * @weaver/worker — Layer C, the autonomous engine.
 *
 * A standalone long-running Node process, deliberately not a Next.js route handler. A healing
 * episode runs 30 to 60 seconds and Vercel terminates a serverless function well before that, so a
 * repair interrupted halfway would leave a collector in an unknown state (ADR-001). The worker also
 * has no inbound HTTP surface at all: it polls, which makes it the easiest possible thing to deploy
 * to Railway, Fly or Render.
 *
 * Two loops share the process:
 *
 *   poll loop  — every 10s, claim a due job with FOR UPDATE SKIP LOCKED and execute it
 *   cron loop  — every 30 min, enqueue one `scheduled` job per ACTIVE collector
 *
 * Today the executor runs a scrape, scores it against the collector's contract, and writes the run
 * to the ledger. It stops at the score: no diagnosis, no heal, no approval. See `runner.ts`.
 */

import { hostname } from 'node:os';

import { createBrightDataClient } from '@weaver/brightdata';

import { ConfigError, loadConfig } from './config.js';
import { createPool, describeDatabase, poolQueryable } from './db.js';
import { createLogger } from './log.js';
import { startCron } from './cron.js';
import { runPollLoop } from './poller.js';
import { createLifecycle } from './shutdown.js';

async function main(): Promise<number> {
  const bootLog = createLogger({ level: 'info', base: { component: 'worker' } });

  let config;
  try {
    config = loadConfig(process.env, { hostname: hostname(), pid: process.pid });
  } catch (error) {
    if (error instanceof ConfigError) {
      // A misconfigured worker must fail at boot with a readable message, not on the first poll.
      bootLog.error('configuration error', { error: error.message });
      return 78; // EX_CONFIG
    }
    throw error;
  }

  const log = createLogger({
    level: config.logLevel,
    base: { component: 'worker', worker_id: config.workerId },
  });

  const lifecycle = createLifecycle({ log, graceMs: config.shutdownGraceMs });

  const pool = createPool({
    databaseUrl: config.databaseUrl,
    ssl: config.databaseSsl,
    max: config.dbPoolMax,
    applicationName: `weaver-worker ${config.workerId}`,
  });
  // An idle-client error (the database restarted, the pooler dropped us) is emitted on the pool and
  // is fatal to the process if unhandled. It is not fatal to us: the next query reconnects.
  pool.on('error', (error) => log.error('idle database client errored', { error }));

  const db = poolQueryable(pool);

  const brightdata = createBrightDataClient({
    allowStoredCredentials: config.allowStoredCredentials,
    logger: (event) =>
      log.debug('cli', {
        phase: event.phase,
        command: event.command,
        argv: event.argvRedacted,
        duration_ms: event.durationMs,
        exit_code: event.exitCode,
        timed_out: event.timedOut,
        ok: event.ok,
      }),
  });

  try {
    const { rows } = await db.query<{ now: string }>('select now()::text as now');
    log.info('worker starting', {
      database: describeDatabase(config.databaseUrl),
      database_time: rows[0]?.now,
      poll_interval_ms: config.pollIntervalMs,
      cron_interval_ms: config.cronIntervalMs,
      max_attempts: config.maxAttempts,
    });
  } catch (error) {
    log.error('cannot reach the database', { database: describeDatabase(config.databaseUrl), error });
    await pool.end().catch(() => {});
    return 69; // EX_UNAVAILABLE
  }

  const cron = startCron({
    db,
    log: log.child({ loop: 'cron' }),
    intervalMs: config.cronIntervalMs,
    runOnBoot: config.cronOnBoot,
  });

  await runPollLoop({
    db,
    brightdata,
    log: log.child({ loop: 'poll' }),
    lifecycle,
    workerId: config.workerId,
    pollIntervalMs: config.pollIntervalMs,
    claimTimeoutMs: config.claimTimeoutMs,
    maxAttempts: config.maxAttempts,
    retryBackoffMs: config.retryBackoffMs,
    rowHistoryWindow: config.rowHistoryWindow,
  });

  cron.stop();
  await pool.end().catch((error: unknown) => log.warn('pool did not close cleanly', { error }));
  lifecycle.release();
  log.info('worker stopped');
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    // Last resort: createLogger rather than the configured one, since config may be why we are here.
    createLogger({ base: { component: 'worker' } }).error('worker crashed', { error });
    process.exitCode = 1;
  },
);
