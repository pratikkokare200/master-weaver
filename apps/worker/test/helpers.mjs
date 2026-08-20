/**
 * Test harness: a real Postgres, in-process.
 *
 * PGlite is Postgres compiled to WASM, so the migration in `supabase/migrations` and the SQL in
 * `src/queue.ts` are executed by an actual Postgres parser and planner rather than compared against
 * expected strings. What these tests prove correct is what the worker ships.
 *
 * The one thing it cannot prove is concurrency: PGlite is single-connection, so `SKIP LOCKED`
 * parses and executes but never actually skips a peer's lock. That behaviour is Postgres's, not
 * ours; what is ours is the shape of the statement, and that is what is under test here.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../supabase/migrations/', import.meta.url));

/** Kept for the schema tests, which assert against the initial migration by name. */
export const MIGRATION_PATH = `${MIGRATIONS_DIR}0001_initial_schema.sql`;

export function readMigration() {
  return readFileSync(MIGRATION_PATH, 'utf8');
}

/**
 * Every migration, in filename order.
 *
 * Read from the directory rather than listed here on purpose: a test database built from a hardcoded
 * subset of migrations drifts from production silently, and the drift is only discovered when
 * something passes locally and fails against Supabase.
 */
export function readAllMigrations() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => readFileSync(`${MIGRATIONS_DIR}${name}`, 'utf8'));
}

/** A fresh in-memory database with every migration applied, adapted to the worker's Queryable. */
export async function freshDb() {
  const pg = await PGlite.create();
  for (const sql of readAllMigrations()) await pg.exec(sql);

  const db = {
    query: async (text, values) => {
      const result = await pg.query(text, values === undefined ? undefined : [...values]);
      return { rows: result.rows };
    },
    close: () => pg.close(),
    raw: pg,
  };
  return db;
}

/** The doc 01 section 3.1 contract, which is what a real collector row carries. */
export const CONTRACT = {
  collector_id: 'c_mpohus372o5tmid1jk',
  fields: [
    { name: 'product_name', type: 'text', required: true, min_fill: 0.95 },
    { name: 'price', type: 'number', required: true, min_fill: 0.9, range: [1, 100000] },
    { name: 'in_stock', type: 'boolean', required: false, min_fill: 0.5 },
    { name: 'product_url', type: 'url', required: true, min_fill: 0.95, absolute: true },
  ],
  row_count: { min: 5, drift_tolerance: 0.5 },
  golden_set: ['https://master-weaver-theta.vercel.app/p/1'],
  golden_set_shape: 'detail',
};

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';

/** Insert a collector and return its row. */
export async function seedCollector(db, overrides = {}) {
  const values = {
    collector_id: `c_${Math.random().toString(36).slice(2, 12)}`,
    name: 'Chaos Lab laptops',
    target_url: 'https://master-weaver-theta.vercel.app/',
    intent_prompt: 'track laptop prices',
    contract: CONTRACT,
    status: 'ACTIVE',
    ...overrides,
  };

  const { rows } = await db.query(
    `insert into collectors
       (workspace_id, collector_id, name, target_url, intent_prompt, contract, status)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7)
     returning *`,
    [
      WORKSPACE_ID,
      values.collector_id,
      values.name,
      values.target_url,
      values.intent_prompt,
      JSON.stringify(values.contract),
      values.status,
    ],
  );
  return rows[0];
}

/** A healthy scraped row, shaped like real CLI output (nested price envelope and input echo). */
export function healthyRow(index = 1) {
  return {
    product_name: `AeroBook Pro ${index}`,
    price: { value: 1299 + index, currency: 'USD', symbol: '$' },
    in_stock: 'In Stock',
    product_url: `https://master-weaver-theta.vercel.app/p/${index}`,
    input: { url: 'https://master-weaver-theta.vercel.app/' },
  };
}

export function scrapedRows(count, patch) {
  return Array.from({ length: count }, (_, i) => {
    const row = healthyRow(i + 1);
    return patch ? patch(row, i) : row;
  });
}

/** A stand-in for the Bright Data client. Records calls; returns whatever you queue up. */
export function fakeBrightData(responses) {
  const queue = [...responses];
  const calls = [];
  return {
    calls,
    runScraper: async (input) => {
      calls.push(input);
      const next = queue.shift();
      if (!next) throw new Error('fakeBrightData: no queued response');
      return next;
    },
  };
}

/** A successful CliResult, matching the adapter's shape. */
export function cliOk(rows) {
  return {
    ok: true,
    data: rows,
    raw: rows,
    command: 'scraper run',
    argvRedacted: 'brightdata scraper run c_test --json',
    exitCode: 0,
    signal: null,
    timedOut: false,
    durationMs: 1234,
    stdout: JSON.stringify(rows),
    stderr: '',
    stderrExcerpt: '',
    truncated: false,
    error: null,
  };
}

/** A failed CliResult, e.g. a timeout. */
export function cliFail(message = 'deadline exceeded', kind = 'timeout') {
  return {
    ok: false,
    data: null,
    raw: null,
    command: 'scraper run',
    argvRedacted: 'brightdata scraper run c_test --json',
    exitCode: null,
    signal: null,
    timedOut: kind === 'timeout',
    durationMs: 180000,
    stdout: '',
    stderr: message,
    stderrExcerpt: message,
    truncated: false,
    error: { kind, message, retryable: kind === 'timeout' },
  };
}

/** Silent logger for tests that are not asserting on output. */
export const testLog = {
  debug() {}, info() {}, warn() {}, error() {},
  child() { return testLog; },
};
