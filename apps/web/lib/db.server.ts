import 'server-only';

import { Pool } from 'pg';

/**
 * The Observation Deck's database access — server only.
 *
 * The `server-only` import at the top is load-bearing: it makes importing this from a client
 * component a build error rather than a runtime surprise, which matters because this module holds a
 * connection string. Layer A is read-only observation plus job enqueueing (doc 03 §3.2), and that is
 * the entire remit — no scraping logic, no CLI calls, no healing decisions.
 *
 * A module-level pool, reused across invocations. Next.js keeps the module alive between requests in
 * a warm lambda, so creating a pool per request would open a connection per request and exhaust
 * Supabase's cap under any real traffic. `max` is deliberately small for the same reason: several
 * lambda instances each hold their own pool, and the cap is shared with the worker.
 */

declare global {
  // eslint-disable-next-line no-var
  var __weaverPool: Pool | undefined;
}

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set — the Observation Deck cannot reach the ledger');
  }

  const isLocal = /localhost|127\.0\.0\.1/.test(connectionString);

  return new Pool({
    connectionString,
    max: 3,
    idleTimeoutMillis: 10_000,
    // A statement that has not answered in ten seconds is not going to help a page render, and
    // holding the connection open makes the next request worse rather than better.
    statement_timeout: 10_000,
    ssl: isLocal ? undefined : { rejectUnauthorized: true },
    application_name: 'weaver-web',
  });
}

/** The shared pool. Reused across warm invocations; created once per process. */
export function pool(): Pool {
  if (!globalThis.__weaverPool) globalThis.__weaverPool = createPool();
  return globalThis.__weaverPool;
}

/** Parameterised query. There is no other kind here — every value from a request is a parameter. */
export async function query<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const result = await pool().query(text, values);
  return result.rows as T[];
}

/**
 * Whether a string is a UUID.
 *
 * Route params arrive from the URL bar and from Discord deep links, so they are untrusted input.
 * Postgres rejects a malformed uuid with an error rather than an empty result, which would turn a
 * typo into a 500; checking first turns it into a 404, which is what it is.
 */
export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
