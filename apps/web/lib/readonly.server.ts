import 'server-only';

import { Pool } from 'pg';

/**
 * The connection text-to-SQL runs on — and the only place in the app that uses it.
 *
 * Separate from `db.server.ts` on purpose. That pool connects as the owner and is what the repair
 * route writes with; this one connects as `weaver_readonly`, which holds SELECT on six tables and
 * nothing else (`supabase/migrations/0003_readonly_role.sql`). Sharing a pool between reviewed
 * queries and generated ones would mean the generated ones inherit the privileges of the reviewed
 * ones, which is the entire thing being avoided.
 *
 * **There is no fallback to `DATABASE_URL`.** If the read-only connection is not configured, the
 * feature reports that it is not configured. A fallback would mean a missing environment variable
 * silently upgrades model-generated SQL to owner privileges — the failure mode most worth designing
 * against, because it would look like everything working.
 */

declare global {
  // eslint-disable-next-line no-var
  var __weaverReadOnlyPool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __weaverReadOnlyChecked: boolean | undefined;
}

export class NotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotConfiguredError';
  }
}

/** How long a generated query may run. Matches the role's own `statement_timeout`. */
const STATEMENT_TIMEOUT_MS = 5_000;

function createPool(): Pool {
  const connectionString = process.env['DATABASE_URL_READONLY'];
  if (!connectionString) {
    throw new NotConfiguredError(
      'DATABASE_URL_READONLY is not set — text-to-SQL needs the read-only role from migration 0003',
    );
  }

  const isLocal = /localhost|127\.0\.0\.1/.test(connectionString);

  return new Pool({
    connectionString,
    // Two. A generated query is one person waiting for one answer; anything larger is a queue of
    // expensive queries competing with the pages that render the dashboard.
    max: 2,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: STATEMENT_TIMEOUT_MS,
    ssl: isLocal ? undefined : { rejectUnauthorized: true },
    application_name: 'weaver-textsql',
  });
}

function pool(): Pool {
  if (!globalThis.__weaverReadOnlyPool) globalThis.__weaverReadOnlyPool = createPool();
  return globalThis.__weaverReadOnlyPool;
}

export interface QueryResult {
  readonly columns: readonly string[];
  readonly rows: readonly Record<string, unknown>[];
}

/**
 * Run a generated statement.
 *
 * Three things happen here that the role already enforces, and they are repeated rather than
 * trusted:
 *
 *   - `set transaction read only`, so the transaction refuses a write even if the connection string
 *     were pointed at a privileged role by mistake
 *   - `set local statement_timeout`, so a runaway query cannot outlive its questioner
 *   - `rollback`, always — a transaction that only ever reads still ends by discarding
 *
 * And one thing the role cannot do for itself: **refuse to run as a superuser.** A superuser ignores
 * every grant in migration 0003, so a `DATABASE_URL_READONLY` that points at `postgres` would run
 * generated SQL with full privileges while looking correctly configured. Checked once per process
 * and cached, because it is a property of the connection string rather than of the query.
 */
export async function runGeneratedQuery(
  sql: string,
  values: readonly unknown[],
): Promise<QueryResult> {
  const client = await pool().connect();

  try {
    if (globalThis.__weaverReadOnlyChecked !== true) {
      const check = await client.query<{ user: string; super: boolean | null }>(
        `select current_user as user,
                (select rolsuper from pg_roles where rolname = current_user) as super`,
      );
      if (check.rows[0]?.super) {
        throw new NotConfiguredError(
          `DATABASE_URL_READONLY connects as ${check.rows[0].user}, which is a superuser — ` +
            'a superuser bypasses every grant, so generated SQL will not be run on it',
        );
      }
      globalThis.__weaverReadOnlyChecked = true;
    }

    await client.query('begin');
    await client.query('set transaction read only');
    await client.query(`set local statement_timeout = ${STATEMENT_TIMEOUT_MS}`);

    const result = await client.query(sql, [...values]);

    await client.query('rollback');

    return {
      columns: result.fields.map((field) => field.name),
      rows: result.rows as Record<string, unknown>[],
    };
  } catch (error) {
    // The rollback may itself fail if the connection died; the original error is the interesting
    // one, so it is not allowed to be replaced by a cleanup failure.
    try {
      await client.query('rollback');
    } catch {
      /* the transaction is already gone */
    }
    throw error;
  } finally {
    client.release();
  }
}

/** Whether the feature is configured at all, without opening a connection. */
export function isTextSqlConfigured(): boolean {
  return Boolean(process.env['DATABASE_URL_READONLY'] && process.env['GROQ_API_KEY']);
}
