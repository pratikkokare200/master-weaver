import assert from 'node:assert/strict';
import test from 'node:test';

import { assertReadOnlySql, UnsafeSqlError, MAX_SQL_CHARS } from '../dist/guard.js';

/** Assert the guard refuses, and say which rule caught it. */
function refuses(sql, reason) {
  assert.throws(
    () => assertReadOnlySql(sql),
    (error) => {
      assert.ok(error instanceof UnsafeSqlError, `expected UnsafeSqlError, got ${error}`);
      if (reason) assert.equal(error.reason, reason, `wrong reason for: ${sql}`);
      return true;
    },
    `should have been refused: ${sql}`,
  );
}

// -------------------------------------------------------------------------------------------
// What must be allowed. A guard that rejects valid analytics is a guard that gets turned off.
// -------------------------------------------------------------------------------------------

test('plain reads are allowed', () => {
  for (const sql of [
    'select count(*) from runs where collector_id = $1',
    'SELECT * FROM runs WHERE collector_id = $1 ORDER BY started_at DESC LIMIT 10',
    "with recent as (select * from runs where collector_id = $1) select count(*) from recent",
    'select item->>$2 from runs, jsonb_array_elements(runs."rows") as item',
  ]) {
    assert.equal(assertReadOnlySql(sql).sql, sql.trim());
  }
});

test('CASE … END is allowed — banning END would reject most useful queries', () => {
  const sql =
    "select case when fhs >= 0.95 then 'HEALTHY' when fhs >= 0.6 then 'DEGRADED' else 'BROKEN' end as band, count(*) from runs where collector_id = $1 group by 1";
  assert.ok(assertReadOnlySql(sql));
});

test('substring(x from 2 for 3) is allowed — FOR is not a banned word', () => {
  assert.ok(assertReadOnlySql("select substring(run_state from 1 for 3) from runs where collector_id = $1"));
});

test('columns whose names contain forbidden words are fine', () => {
  // `offset` contains `set`; `created_at` contains `create`; `started_at` contains `start`.
  assert.ok(assertReadOnlySql('select created_at, started_at from runs where collector_id = $1 offset 5'));
});

test('a string literal that looks like an attack is just data', () => {
  const sql = "select * from runs where collector_id = $1 and run_state = 'DROP TABLE runs; --'";
  assert.equal(assertReadOnlySql(sql).sql, sql);
});

// -------------------------------------------------------------------------------------------
// Writes
// -------------------------------------------------------------------------------------------

test('every write verb is refused', () => {
  refuses('delete from runs', 'not_a_read');
  refuses('update collectors set name = $1', 'not_a_read');
  refuses('insert into runs (id) values (1)', 'not_a_read');
  refuses('drop table runs', 'not_a_read');
  refuses('truncate runs', 'not_a_read');
  refuses('grant select on runs to public', 'not_a_read');
});

test('a write hidden after a SELECT is refused as a second statement', () => {
  refuses('select 1; drop table runs', 'multiple_statements');
  refuses("select * from runs where collector_id = $1; delete from jobs", 'multiple_statements');
});

test('a data-modifying CTE is refused — its first keyword is WITH, its effect is a write', () => {
  refuses(
    "with gone as (delete from runs where collector_id = $1 returning id) select count(*) from gone",
    'forbidden_keyword',
  );
  refuses(
    "with added as (insert into jobs (collector_id) values ($1) returning id) select * from added",
    'forbidden_keyword',
  );
});

test('SELECT … INTO is refused — a SELECT by its first word, a CREATE by its effect', () => {
  refuses('select * into new_table from runs', 'forbidden_keyword');
});

test('turning the read-only transaction off is refused', () => {
  refuses('set default_transaction_read_only = off', 'not_a_read');
  refuses('select 1 from runs where 1 = 1 /* */ ; set default_transaction_read_only = off', 'multiple_statements');
});

test('row locks: FOR UPDATE is caught here, FOR SHARE by the read-only transaction', () => {
  // `for` is not a forbidden word — `substring(x from 2 for 3)` needs it — so FOR UPDATE is caught
  // incidentally, by `update`. FOR SHARE has no banned word in it and passes this layer; Postgres
  // then refuses it with "cannot execute SELECT FOR SHARE in a read-only transaction".
  refuses('select id from jobs where collector_id = $1 for update', 'forbidden_keyword');
  assert.ok(assertReadOnlySql('select id from jobs where collector_id = $1 for share'));
});

// -------------------------------------------------------------------------------------------
// Comments, quoting, and the tricks that get past naive checks
// -------------------------------------------------------------------------------------------

test('a statement hidden behind a comment is still found', () => {
  refuses('select 1 -- \n; drop table runs', 'multiple_statements');
  refuses('select 1 /* harmless */; drop table runs', 'multiple_statements');
});

test('a nested block comment does not swallow the rest of the statement', () => {
  refuses('select 1 /* a /* b */ */ ; drop table runs', 'multiple_statements');
});

test('dollar quoting does not smuggle a semicolon past the check', () => {
  const sql = "select * from runs where collector_id = $1 and run_state = $tag$; drop table runs$tag$";
  assert.ok(assertReadOnlySql(sql), 'a dollar-quoted literal is data');
  refuses('select $tag$x$tag$; drop table runs', 'multiple_statements');
});

test('an unterminated quote is refused rather than half-checked', () => {
  refuses("select * from runs where name = 'unclosed", 'unterminated');
  refuses('select 1 /* unclosed', 'unterminated');
});

test('a quoted identifier cannot be read as a keyword', () => {
  assert.ok(assertReadOnlySql('select "rows" from runs where collector_id = $1'));
  assert.ok(assertReadOnlySql('select 1 as "delete" from runs where collector_id = $1'));
});

test('E-strings with backslash escapes are lexed correctly', () => {
  assert.ok(assertReadOnlySql("select * from runs where run_state = E'BROKEN\\''"));
  refuses("select E'x'; drop table runs", 'multiple_statements');
});

// -------------------------------------------------------------------------------------------
// Shape
// -------------------------------------------------------------------------------------------

test('a trailing semicolon is allowed and stripped', () => {
  assert.equal(assertReadOnlySql('select 1;').sql, 'select 1');
  assert.equal(assertReadOnlySql('select 1 ;;  ').sql, 'select 1');
});

test('empty input is refused', () => {
  refuses('', 'empty');
  refuses('   ', 'empty');
  refuses(';', 'empty');
});

test('an over-long statement is refused before it is parsed', () => {
  refuses(`select ${'a'.repeat(MAX_SQL_CHARS)} from runs`, 'too_long');
});

test('filesystem and sleep functions are named rather than left to a permission error', () => {
  refuses("select pg_read_file('/etc/passwd')", 'forbidden_function');
  refuses('select pg_sleep(60)', 'forbidden_function');
  refuses('select PG_SLEEP (60)', 'forbidden_function');
});

// -------------------------------------------------------------------------------------------
// The row limit
// -------------------------------------------------------------------------------------------

test('the statement runs wrapped in a limit, and the wrapper is not what is shown', () => {
  const safe = assertReadOnlySql('select * from runs where collector_id = $1', 25);
  assert.equal(safe.sql, 'select * from runs where collector_id = $1');
  assert.match(safe.executable, /^select \* from \(/);
  assert.match(safe.executable, /\) as weaver_result limit 25$/);
  assert.equal(safe.limit, 25);
});

test("the wrapper does not override the query's own smaller limit", () => {
  const safe = assertReadOnlySql('select * from runs limit 3', 200);
  assert.ok(safe.executable.includes('limit 3'));
  assert.ok(safe.executable.endsWith('limit 200'));
});
