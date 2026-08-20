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
 * NUL — the one code point Postgres will not store.
 *
 * `text` and `jsonb` both reject U+0000 at any nesting depth: the driver sends the escape and the
 * server answers `unsupported Unicode escape sequence`. Every other control character is fine.
 */
const NUL_PATTERN = /\u0000/g;

/**
 * Strip NULs from anything on its way into Postgres.
 *
 * This exists because of a real failure, not a hypothetical one. The first autonomous healing
 * episode reached its verdict, went to write it, and died in `closeEpisode` on a NUL that had
 * arrived from `rowIdentity`'s separator (since changed — see `@weaver/validation ›
 * IDENTITY_SEPARATOR`). One byte, and the engine lost the only record of what it had decided.
 *
 * Losing the verdict is worse than losing the repair. `healing_episodes_open_idx` is a plain partial
 * index rather than a unique one, so nothing stops a second episode opening: the run stayed BROKEN,
 * the ledger held no evidence that a repair had already been tried and had already failed its
 * confirmation, and the next cron tick started the whole thing again — mutating the collector and
 * spending credits a second time, fifteen minutes later. The breaker's 24-hour attempt rail is what
 * eventually stops that, and a rail meant as a backstop should not be the thing doing the work.
 *
 * Fixing the separator alone would not be enough, which is why this sits at the seam instead. Every
 * jsonb column in this schema holds content from a page we do not control — `runs.rows` is raw CLI
 * output, `snapshot_before` and `snapshot_after` are scraped samples — and a site is perfectly
 * capable of serving a NUL in a product name. For an episode this is the worst possible place to
 * discover unstorable input: the ledger write is the LAST thing that happens, so by the time it runs
 * the credits are spent and the collector is already mutated. A write of *observations* must not be
 * able to fail on their content.
 *
 * Stripping rather than escaping is deliberate. A NUL carries no meaning in scraped text, and a
 * snapshot missing one invisible character is worth incomparably more than no snapshot at all.
 *
 * Note this is not an injection defence and does not stand in for one — every value in this codebase
 * reaches Postgres as a bound parameter. This is purely about storability.
 */
export function pgSafe(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.includes('\u0000') ? value.replace(NUL_PATTERN, '') : value;
  }
  if (Array.isArray(value)) return value.map(pgSafe);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    // Keys need the same treatment as values: a NUL in a key fails the write just as hard.
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      out[key.replace(NUL_PATTERN, '')] = pgSafe(inner);
    }
    return out;
  }
  return value;
}

/** {@link pgSafe} for a value already known to be a string, keeping the type at the call site. */
export function pgSafeText<T extends string | null | undefined>(value: T): T {
  return (typeof value === 'string' ? pgSafe(value) : value) as T;
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
