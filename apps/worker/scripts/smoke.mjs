/**
 * End-to-end smoke test: the real worker binary, against a real Postgres.
 *
 * The unit suite proves each module against PGlite in-process. This proves the *program*: it serves
 * PGlite over a TCP socket so node-postgres connects over the real wire protocol, points the CLI
 * adapter at a fake `brightdata` shim, spawns `dist/index.js` as a separate process, and then reads
 * the ledger to see what the worker actually did.
 *
 *   pnpm --filter @weaver/worker smoke
 */

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const PORT = Number(process.env.SMOKE_PORT ?? 55432);
const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));

const failures = [];
function check(ok, label) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures.push(label);
}

const db = await PGlite.create();
await db.exec(readFileSync(here('../../../supabase/migrations/0001_initial_schema.sql'), 'utf8'));

await db.query(
  `insert into collectors (workspace_id, collector_id, name, target_url, intent_prompt, contract, status)
   values (gen_random_uuid(), 'c_smoke_test', 'Chaos Lab laptops',
           'https://master-weaver-theta.vercel.app/', 'track laptop prices', $1::jsonb, 'ACTIVE')`,
  [JSON.stringify({
    collector_id: 'c_smoke_test',
    fields: [
      { name: 'product_name', type: 'text', required: true, min_fill: 0.95 },
      { name: 'price', type: 'number', required: true, min_fill: 0.9, range: [1, 100000] },
      { name: 'in_stock', type: 'boolean', required: false, min_fill: 0.5 },
      { name: 'product_url', type: 'url', required: true, min_fill: 0.95, absolute: true },
    ],
    row_count: { min: 5, drift_tolerance: 0.5 },
    golden_set: ['https://master-weaver-theta.vercel.app/p/1'],
    golden_set_shape: 'detail',
  })],
);

const server = new PGLiteSocketServer({ db, port: PORT, host: '127.0.0.1' });
await server.start();
console.log(`postgres listening on 127.0.0.1:${PORT}\n`);

const worker = spawn(process.execPath, [here('../dist/index.js')], {
  env: {
    ...process.env,
    DATABASE_URL: `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`,
    BRIGHTDATA_API_KEY: 'smoke_test_key',
    BRIGHTDATA_CLI_BIN: here('fake-brightdata.cmd'),
    FAKE_ROW_COUNT: '12',
    WORKER_CRON_ON_BOOT: 'true',
    WORKER_CRON_INTERVAL_MS: '60000',
    WORKER_POLL_INTERVAL_MS: '500',
    // PGLiteSocketServer serves one connection at a time; the real Supabase pooler does not care.
    WORKER_DB_POOL_MAX: '1',
    LOG_LEVEL: 'debug',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

const log = [];
worker.stdout.on('data', (chunk) => { log.push(String(chunk)); process.stdout.write(chunk); });
worker.stderr.on('data', (chunk) => process.stderr.write(chunk));

/** Wait for a predicate against the ledger, or give up. */
async function until(label, predicate, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  console.error(`timed out waiting for: ${label}`);
  return false;
}

const oneRow = async (sql) => (await db.query(sql)).rows[0];

try {
  check(
    await until('the cron to enqueue a scheduled job', async () =>
      (await oneRow(`select count(*)::int as n from jobs where kind = 'scheduled'`)).n === 1),
    'the cron enqueues a scheduled job for the active collector',
  );

  check(
    await until('the run to finish', async () =>
      (await oneRow(`select count(*)::int as n from runs where finished_at is not null`)).n === 1),
    'the poller claims the job, runs the scraper and closes the run',
  );

  const run = await oneRow(`select * from runs limit 1`);
  check(run.run_state === 'HEALTHY', `the run is scored HEALTHY (got ${run.run_state})`);
  check(Number(run.fhs) === 1, `the run scores 1 (got ${run.fhs})`);
  check(run.row_count === 12, `all 12 rows are recorded (got ${run.row_count})`);
  check(run.rows[0]?.price?.value === 1299, 'the nested price envelope survives into jsonb verbatim');
  check(run.field_scores?.length === 4, 'per-field detail is written alongside the score');

  const job = await oneRow(`select * from jobs limit 1`);
  check(job.state === 'DONE', `the job is marked DONE (got ${job.state})`);
  check(typeof job.claimed_by === 'string', 'the job records which worker ran it');
  check(job.attempts === 1, `the job was claimed exactly once (got ${job.attempts})`);

  const joined = log.join('');
  check(joined.includes('"msg":"worker starting"'), 'the worker logs a structured startup line');
  check(!joined.includes('smoke_test_key'), 'the API key never appears in the logs');
} finally {
  worker.kill();
  await server.stop();
  await db.close();
}

console.log(`\n${failures.length === 0 ? 'SMOKE PASSED' : `SMOKE FAILED: ${failures.length}`}`);
process.exit(failures.length === 0 ? 0 : 1);
