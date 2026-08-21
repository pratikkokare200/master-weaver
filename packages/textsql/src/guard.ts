import { lex } from './lex.js';

/**
 * What a generated statement must be before it is allowed near the database.
 *
 * This is the FIRST of two defences, and the weaker one by design. It is a string check on text a
 * language model produced from text a user typed, and string checks lose to inputs nobody thought
 * of. The one that holds when this fails is `supabase/migrations/0003_readonly_role.sql`: the
 * connection this runs on has SELECT and nothing else, inside a transaction Postgres has already
 * marked read-only.
 *
 * Both exist because neither is sufficient. The role cannot stop a SELECT that reads a column it is
 * entitled to read but shouldn't in this context; the guard cannot anticipate every spelling of a
 * write. Together they mean a bypass needs two independent failures.
 *
 * The guard is deliberately strict and deliberately dumb. It rejects rather than repairs — a guard
 * that rewrites a statement into something acceptable is a guard whose output nobody has reviewed.
 */

export class UnsafeSqlError extends Error {
  /** A short machine-readable reason, so the route can log it without parsing prose. */
  readonly reason: string;

  constructor(reason: string, message: string) {
    super(message);
    this.name = 'UnsafeSqlError';
    this.reason = reason;
  }
}

/**
 * Words that must not appear as code.
 *
 * Everything that writes, everything that changes session state, and three that are easy to miss:
 *
 *   - `into` — `SELECT … INTO new_table` creates a table. It is a SELECT by its first keyword and a
 *     CREATE by its effect, which is exactly the shape a first-word check waves through.
 *   - `set` and `reset` — `SET default_transaction_read_only = off` would undo the second defence
 *     from inside the first one.
 *   - `with` is ALLOWED as a first keyword, which lets through `WITH x AS (INSERT …) SELECT …` — a
 *     data-modifying CTE, a write whose first word is WITH. `insert` in this list is what stops it.
 *
 * Two words are deliberately NOT here, and both were checked against Postgres rather than guessed:
 *
 *   - `end`, because `CASE … END` is ordinary analytic SQL and banning it would reject most useful
 *     queries. `begin` is banned, and END without BEGIN does nothing.
 *   - `for`, because `substring(x from 2 for 3)` is legitimate. `SELECT … FOR UPDATE` is still
 *     caught here — by `update` — and `FOR SHARE`, which is not, is refused by the read-only
 *     transaction: `cannot execute SELECT FOR SHARE in a read-only transaction`. Checked against
 *     Postgres rather than assumed.
 *
 * Matched with word boundaries against the lexer's code-only view, so `offset`, `created_at` and a
 * product literally named 'DROP TABLE runs' are all fine.
 */
const FORBIDDEN = [
  'insert', 'update', 'delete', 'merge', 'truncate', 'drop', 'alter', 'create', 'grant', 'revoke',
  'comment', 'copy', 'call', 'do', 'execute', 'prepare', 'deallocate', 'declare', 'move',
  'listen', 'notify', 'unlisten', 'lock', 'vacuum', 'analyze', 'analyse', 'reindex', 'cluster',
  'refresh', 'discard', 'checkpoint', 'begin', 'start', 'commit', 'rollback', 'savepoint',
  'set', 'reset', 'into', 'returning', 'security',
] as const;

/**
 * Functions that read or write outside the database. None are available to an unprivileged role, so
 * this is redundant with the grants — and named anyway, because a query that tries is a signal
 * worth refusing loudly rather than letting Postgres answer with a permission error.
 */
const FORBIDDEN_FUNCTIONS = [
  'pg_read_file', 'pg_read_binary_file', 'pg_ls_dir', 'pg_stat_file', 'lo_import', 'lo_export',
  'dblink', 'pg_sleep', 'pg_terminate_backend', 'pg_cancel_backend', 'pg_reload_conf',
] as const;

/** The upper bound on a generated statement. Longer than this is not a question, it is a payload. */
export const MAX_SQL_CHARS = 4_000;

/** Rows returned to the page. Enough to answer a question, not enough to be an export. */
export const DEFAULT_ROW_LIMIT = 200;

export interface SafeSql {
  /** The statement as written, trimmed — what gets shown to the user. Never hidden. */
  readonly sql: string;
  /** The statement as executed: the same query, wrapped in a row limit. */
  readonly executable: string;
  readonly limit: number;
}

function firstKeyword(code: string): string {
  const match = /[a-z_][a-z0-9_]*/i.exec(code);
  return (match?.[0] ?? '').toLowerCase();
}

/**
 * Check a generated statement, or throw.
 *
 * Returns both the statement as written and the statement as executed. They differ by the row
 * limit, and the difference is not hidden: the panel shows `sql`, because showing the query is what
 * separates this from a chatbot that might be making things up.
 */
export function assertReadOnlySql(input: string, limit = DEFAULT_ROW_LIMIT): SafeSql {
  const sql = input.trim().replace(/;+\s*$/, '').trim();

  if (sql === '') throw new UnsafeSqlError('empty', 'no statement was generated');
  if (sql.length > MAX_SQL_CHARS) {
    throw new UnsafeSqlError('too_long', `statement is ${sql.length} characters, over the ${MAX_SQL_CHARS} limit`);
  }

  const { code, semicolons, unterminated } = lex(sql);

  // An unclosed quote means the lexer's view of what is code and what is text is wrong, and every
  // check below reads that view. Refuse rather than check something we cannot see properly.
  if (unterminated) {
    throw new UnsafeSqlError('unterminated', 'the statement has an unclosed quote or comment');
  }

  // The trailing semicolon is already gone, so any remaining one separates two statements. This is
  // the classic injection shape — `select 1; drop table runs` — and the reason the check runs
  // against the lexer's output rather than the raw text.
  if (semicolons.length > 0) {
    throw new UnsafeSqlError('multiple_statements', 'only one statement may be run at a time');
  }

  const keyword = firstKeyword(code);
  if (keyword !== 'select' && keyword !== 'with' && keyword !== 'table' && keyword !== 'values') {
    throw new UnsafeSqlError('not_a_read', `statements must begin with SELECT or WITH, not ${keyword.toUpperCase() || 'nothing'}`);
  }

  const lowered = code.toLowerCase();

  for (const word of FORBIDDEN) {
    if (new RegExp(`\\b${word}\\b`).test(lowered)) {
      throw new UnsafeSqlError('forbidden_keyword', `${word.toUpperCase()} is not allowed in a generated query`);
    }
  }

  for (const fn of FORBIDDEN_FUNCTIONS) {
    if (new RegExp(`\\b${fn}\\s*\\(`).test(lowered)) {
      throw new UnsafeSqlError('forbidden_function', `${fn}() is not allowed in a generated query`);
    }
  }

  return {
    sql,
    // Wrapped rather than inspected for an existing LIMIT. Finding the TOP-LEVEL limit of an
    // arbitrary query means parsing it — subqueries and CTEs have their own — and a wrapper is
    // exact without parsing anything. A query that already limits to 10 still returns 10.
    executable: `select * from (\n${sql}\n) as weaver_result limit ${limit}`,
    limit,
  };
}
