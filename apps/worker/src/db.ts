/**
 * The database seam.
 *
 * Everything below talks to a {@link Queryable} rather than to a `pg.Pool`, for one concrete
 * reason: it lets the queue tests run the *actual* SQL in this codebase against a real Postgres
 * (PGlite, Postgres compiled to WASM) instead of asserting on strings. The SQL that the tests prove
 * correct is the SQL the worker ships.
 *
 * Why node-postgres and not `@supabase/supabase-js`: the queue claim is
 * `SELECT ... FOR UPDATE SKIP LOCKED`, and PostgREST has no way to express a locking clause. Doc 03
 * section 3.4 and ADR-001 specify Postgres-as-queue, so the worker speaks Postgres. The web app is
 * free to use supabase-js for its reads; it never claims a job.
 */

import pg from 'pg';

/** The minimum a client must do for this worker. `pg.Pool` and PGlite both satisfy it. */
export interface Queryable {
  query<T>(text: string, values?: readonly unknown[]): Promise<{ rows: T[] }>;
}

/**
 * Parse `numeric` into a JS number.
 *
 * node-postgres returns NUMERIC as a *string* by default, and it is right to: numeric is arbitrary
 * precision and float64 is not. Every numeric column in this schema is an FHS in [0,1] or a credit
 * count, none of which come close to needing more than float64's 15 significant digits, so parsing
 * here is safe and saves every read site from remembering to do it. If a column that genuinely
 * needs arbitrary precision is ever added, give it its own parser rather than removing this one.
 */
export function installNumericParser(types: typeof pg.types = pg.types): void {
  const NUMERIC_OID = 1700;
  types.setTypeParser(NUMERIC_OID, (value: string) => (value === null ? null : Number(value)));
}

export interface PoolOptions {
  databaseUrl: string;
  ssl: false | { rejectUnauthorized: boolean };
  /** The worker runs one job at a time; the cron and the reaper are the only other users. */
  max?: number;
  applicationName?: string;
}

export function createPool(options: PoolOptions): pg.Pool {
  installNumericParser();

  return new pg.Pool({
    connectionString: options.databaseUrl,
    ssl: options.ssl,
    max: options.max ?? 4,
    application_name: options.applicationName ?? 'weaver-worker',
    // A queue poller holds no long transactions, so a connection that stops answering is a dead
    // connection rather than a busy one.
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
}

/** Adapt a `pg.Pool` to {@link Queryable}. */
export function poolQueryable(pool: pg.Pool): Queryable {
  return {
    query: async <T>(text: string, values?: readonly unknown[]) => {
      const result = await pool.query(text, values as unknown[] | undefined);
      return { rows: result.rows as T[] };
    },
  };
}

/** The database host, for a startup log line that must never contain the password. */
export function describeDatabase(databaseUrl: string): string {
  try {
    const url = new URL(databaseUrl);
    return `${url.hostname}:${url.port || '5432'}${url.pathname}`;
  } catch {
    return '<unparseable>';
  }
}
