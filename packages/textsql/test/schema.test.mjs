import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';

import { SCHEMA, schemaPrompt } from '../dist/schema.js';

/**
 * Drift, in both directions.
 *
 * `schema.ts` is written by hand — the model needs to know what a column MEANS, and
 * `information_schema` does not carry that. The cost of writing it by hand is that it can fall out
 * of step with the migrations, and both directions of drift are silent failures:
 *
 *   - a column described here that no longer exists → the model writes queries that error
 *   - a column that exists and is not described → the model cannot answer questions about it, and
 *     has no way to say why
 *
 * So the real migrations are applied to a real Postgres and the description is checked against
 * them. PGlite is Postgres compiled to WASM, so this is the same parser Supabase runs.
 */

const MIGRATIONS = fileURLToPath(new URL('../../../supabase/migrations/', import.meta.url));

async function liveColumns() {
  const pg = await PGlite.create();
  for (const name of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    await pg.exec(readFileSync(MIGRATIONS + name, 'utf8'));
  }

  const result = await pg.query(
    `select table_name, column_name
       from information_schema.columns
      where table_schema = 'public'
      order by table_name, ordinal_position`,
  );
  await pg.close();

  const byTable = new Map();
  for (const row of result.rows) {
    if (!byTable.has(row.table_name)) byTable.set(row.table_name, new Set());
    byTable.get(row.table_name).add(row.column_name);
  }
  return byTable;
}

test('every table the prompt describes exists in the migrations', async () => {
  const live = await liveColumns();
  for (const table of SCHEMA) {
    assert.ok(live.has(table.name), `described but missing from the schema: ${table.name}`);
  }
});

test('every column the prompt describes exists', async () => {
  const live = await liveColumns();
  for (const table of SCHEMA) {
    const columns = live.get(table.name);
    for (const column of table.columns) {
      assert.ok(columns?.has(column.name), `described but missing: ${table.name}.${column.name}`);
    }
  }
});

test('every column of those tables is described — a new column must reach the prompt', async () => {
  const live = await liveColumns();
  for (const table of SCHEMA) {
    const described = new Set(table.columns.map((c) => c.name));
    for (const column of live.get(table.name) ?? []) {
      assert.ok(described.has(column), `undescribed column: ${table.name}.${column}`);
    }
  }
});

test('the ledger tables are all covered — none was forgotten entirely', async () => {
  const live = await liveColumns();
  const described = new Set(SCHEMA.map((t) => t.name));
  for (const table of live.keys()) {
    assert.ok(described.has(table), `table not described to the model: ${table}`);
  }
});

test('the prompt names the reserved column correctly', () => {
  const prompt = schemaPrompt();
  // `rows` is reserved in the SQL standard, so it is double-quoted everywhere it appears. A prompt
  // that says `runs.rows` teaches the model to write a query that fails to parse.
  assert.match(prompt, /runs\."rows"/);
  assert.match(prompt, /jsonb_array_elements/);
});

test('the enum values come from contracts, not from a second copy', () => {
  const prompt = schemaPrompt();
  for (const state of ['PENDING_OPERATOR', 'CANARY_VALIDATING', 'QUARANTINED', 'RESTORED']) {
    assert.ok(prompt.includes(state), `run state missing from the prompt: ${state}`);
  }
});
