/**
 * Seed the ledger with the Day 2 demo fixtures.
 *
 *   pnpm --filter @weaver/worker seed
 *
 * Two collectors pointed at the Chaos Lab, and one golden baseline for the listings collector. This
 * is the state the engine needs before the 30-minute cron has anything to sweep: the cron enqueues
 * one `scheduled` job per ACTIVE collector, so an empty `collectors` table means a worker that ticks
 * forever and collects nothing.
 *
 * Idempotent by design. Every insert upserts on the natural key — `collectors.collector_id` and
 * `golden_baselines (collector_id, url)` — so re-running after a schema reset or a tweak to a
 * contract updates in place rather than erroring on a duplicate or growing a second row.
 *
 * Deliberately NOT wired into the worker's boot path. Seeding is an operator action against a
 * specific database; a worker that seeded on startup would rewrite a production contract every time
 * the process restarted.
 */

import { parseCollectorContract } from '@weaver/contracts';
import type { CollectorContract, ListingBaselineSummary, ScrapedRow } from '@weaver/contracts';

import { resolveSsl } from './config.js';
import { createPool, describeDatabase, poolQueryable } from './db.js';
import type { Queryable } from './db.js';
import { createLogger } from './log.js';

// ---------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------

/**
 * The Chaos Lab origin.
 *
 * Defaults to the deployed site rather than `localhost:3001` on purpose: Bright Data runs the scrape
 * from its own infrastructure, so a collector pointed at a loopback address resolves to Bright
 * Data's loopback, not ours. Override for a local run behind a tunnel.
 */
const CHAOS_LAB_BASE = (
  process.env['CHAOS_LAB_BASE_URL'] ?? 'https://master-weaver-theta.vercel.app'
).replace(/\/+$/, '');

/**
 * There is no workspaces table yet (no auth in the six), so `workspace_id` is a bare uuid. Fixed
 * rather than random so that re-running the seed does not strand the previous run's rows under a
 * workspace nothing queries.
 */
const WORKSPACE_ID = process.env['WEAVER_WORKSPACE_ID'] ?? '11111111-1111-4111-8111-111111111111';

/**
 * The healthy layout. `?layout=v1` is the standard table — `<td class="product-name">`,
 * `<td class="price">$1,299.00</td>`. `v2` is the deliberate breakage the demo triggers, and `v3`
 * the subtle one that splits the price across three spans.
 */
const LISTINGS_URL = `${CHAOS_LAB_BASE}/?layout=v1`;
const REVIEWS_URL = `${CHAOS_LAB_BASE}/reviews`;

/**
 * The golden-set match rate this baseline is held to: a full match, nothing less.
 *
 * NOTE: `golden_baselines` has no threshold column, and that is not an oversight — doc 01 §3.4 makes
 * the match rate a *scorer* input rather than a stored setting. The scorer folds it in as
 * `FHS_final = FHS × row_penalty × golden_penalty` where `golden_penalty` IS the match rate, so a
 * threshold of 1.0 is what you get by feeding the measured rate in unmodified: a 5-of-6 match scales
 * the score to 0.83 rather than passing a `>= 0.83` test. Recorded here as a named constant so the
 * intent is greppable from the seed that established the baseline.
 */
const GOLDEN_MATCH_THRESHOLD = 1.0;

/**
 * One scraped row as the Bright Data CLI actually returns it.
 *
 * Values are NOT all scalars: `price` comes back as an envelope, and every row carries an `input`
 * echo of the URL it was collected from. A `number` contract on `price` reads `price.value` — see
 * the note on `ScrapedRow` in @weaver/contracts.
 */
function listingRow(name: string, price: number, productId: number): ScrapedRow {
  return {
    product_name: name,
    price: { value: price, currency: 'USD', symbol: '$' },
    in_stock: 'In Stock',
    product_url: `${CHAOS_LAB_BASE}/p/${productId}`,
    input: { url: LISTINGS_URL },
  };
}

const LISTINGS_CONTRACT: CollectorContract = {
  collector_id: 'c_seed_marketplace_listings',
  fields: [
    { name: 'product_name', type: 'text', required: true, min_fill: 0.95 },
    {
      name: 'price',
      type: 'number',
      required: true,
      min_fill: 0.9,
      range: [1, 100000],
      // A real sale moves a laptop 20–30%; 35% is the band that catches `0`, `null` and "scraped the
      // shipping cost instead" without false-alarming on Black Friday (GOLDEN_TOLERANCES.PRICE).
      drift_tolerance: 0.35,
    },
    { name: 'in_stock', type: 'boolean', required: false, min_fill: 0.5 },
    { name: 'product_url', type: 'url', required: true, min_fill: 0.95, absolute: true },
  ],
  // The Chaos Lab lists 12 products. `min: 5` leaves room for the site to shrink without crying
  // breakage, while still catching the failure where a selector matches one stray row.
  row_count: { min: 5, drift_tolerance: 0.5 },
  golden_set: [LISTINGS_URL],
  // One category URL yielding many rows: the baseline asserts the row *set*, not per-row values.
  golden_set_shape: 'listing',
};

const REVIEWS_CONTRACT: CollectorContract = {
  collector_id: 'c_seed_product_reviews',
  fields: [
    { name: 'reviewer_name', type: 'text', required: true, min_fill: 0.9 },
    { name: 'rating', type: 'number', required: true, min_fill: 0.95, range: [1, 5] },
    { name: 'review_title', type: 'text', required: false, min_fill: 0.6 },
    { name: 'review_body', type: 'text', required: true, min_fill: 0.85 },
    { name: 'review_date', type: 'text', required: false, min_fill: 0.7 },
  ],
  row_count: { min: 3, drift_tolerance: 0.5 },
  golden_set: [REVIEWS_URL],
  golden_set_shape: 'listing',
};

/**
 * The listings baseline — the regression test. Without it, RESTORED is an unverified claim.
 *
 * `listing` shape, so the payload is a summary of the row set rather than one product: the count,
 * the field shape across rows, and the first N rows by a stable key. Captured from the healthy v1
 * layout, which is what makes it a baseline worth comparing a repair against.
 */
const LISTINGS_BASELINE: ListingBaselineSummary = {
  row_count: 12,
  field_shape: ['product_name', 'price', 'in_stock', 'product_url'],
  sample_rows: [
    listingRow('AeroBook Pro 14', 1299, 1),
    listingRow('Zenith Precision 16', 1899, 2),
    listingRow('Nova Ultralight 13', 1199, 3),
  ],
  // Ordered by URL rather than by name or grid position: a redesign that reorders the listing must
  // not read as a changed row set.
  stable_key: 'product_url',
};

interface CollectorSeed {
  name: string;
  targetUrl: string;
  intentPrompt: string;
  contract: CollectorContract;
}

const COLLECTORS: CollectorSeed[] = [
  {
    name: 'marketplace-listings',
    targetUrl: LISTINGS_URL,
    intentPrompt:
      'Track the name, price, stock status and product link of every laptop on the Chaos Lab marketplace listing page.',
    contract: LISTINGS_CONTRACT,
  },
  {
    name: 'product-reviews',
    targetUrl: REVIEWS_URL,
    intentPrompt:
      'Collect the reviewer name, star rating, title, body and date of every customer review on the Chaos Lab reviews page.',
    contract: REVIEWS_CONTRACT,
  },
];

// ---------------------------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------------------------

/**
 * Upsert a collector, returning our uuid primary key.
 *
 * The conflict target is `collector_id` — Bright Data's id, which is unique because it is what every
 * CLI call is addressed to. `created_at` is left alone on update, so re-seeding does not rewrite
 * history.
 */
async function upsertCollector(db: Queryable, seed: CollectorSeed): Promise<string> {
  // Contracts are validated at the boundary even when hand-written: this file is the one place a
  // typo in a field name would be silently accepted and then resurface as a scoring bug days later.
  const contract = parseCollectorContract(seed.contract);

  const { rows } = await db.query<{ id: string }>(
    `insert into collectors
       (workspace_id, collector_id, name, target_url, intent_prompt, contract, status)
     values ($1, $2, $3, $4, $5, $6::jsonb, 'ACTIVE')
     on conflict (collector_id) do update set
       workspace_id  = excluded.workspace_id,
       name          = excluded.name,
       target_url    = excluded.target_url,
       intent_prompt = excluded.intent_prompt,
       contract      = excluded.contract,
       status        = excluded.status
     returning id`,
    [
      WORKSPACE_ID,
      contract.collector_id,
      seed.name,
      seed.targetUrl,
      seed.intentPrompt,
      JSON.stringify(contract),
    ],
  );

  const row = rows[0];
  if (!row) throw new Error(`upsert of collector ${seed.name} returned no row`);
  return row.id;
}

/**
 * Upsert the golden baseline for a collector.
 *
 * A refresh is an upsert on `(collector_id, url)`, never an append — otherwise "refresh on every
 * HEALTHY run" would grow unbounded. `captured_at` is bumped, because a refreshed baseline is a new
 * capture.
 */
async function upsertGoldenBaseline(
  db: Queryable,
  collectorId: string,
  url: string,
  baseline: ListingBaselineSummary,
): Promise<void> {
  await db.query(
    `insert into golden_baselines (collector_id, url, baseline_row, shape)
     values ($1, $2, $3::jsonb, 'listing')
     on conflict (collector_id, url) do update set
       baseline_row = excluded.baseline_row,
       shape        = excluded.shape,
       captured_at  = now()`,
    [collectorId, url, JSON.stringify(baseline)],
  );
}

// ---------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------

async function main(): Promise<number> {
  const log = createLogger({ level: 'info', base: { component: 'seed' } });

  // Deliberately not `loadConfig`: seeding needs a database and nothing else, and requiring
  // BRIGHTDATA_API_KEY here would block an operator who only wants to populate a fresh schema.
  const databaseUrl = (process.env['DATABASE_URL'] ?? process.env['SUPABASE_DB_URL'] ?? '').trim();
  if (databaseUrl === '') {
    log.error('DATABASE_URL is not set — seeding needs a database connection string');
    return 78; // EX_CONFIG
  }

  const pool = createPool({
    databaseUrl,
    ssl: resolveSsl(databaseUrl, process.env),
    max: 1,
    applicationName: 'weaver-seed',
  });
  const db = poolQueryable(pool);

  try {
    log.info('seeding', { database: describeDatabase(databaseUrl), chaos_lab: CHAOS_LAB_BASE });

    const ids = new Map<string, string>();
    for (const seed of COLLECTORS) {
      const id = await upsertCollector(db, seed);
      ids.set(seed.name, id);
      log.info('collector seeded', {
        name: seed.name,
        id,
        collector_id: seed.contract.collector_id,
        target_url: seed.targetUrl,
        shape: seed.contract.golden_set_shape,
      });
    }

    const listingsId = ids.get('marketplace-listings');
    if (!listingsId) throw new Error('marketplace-listings was not seeded');

    await upsertGoldenBaseline(db, listingsId, LISTINGS_URL, LISTINGS_BASELINE);
    log.info('golden baseline seeded', {
      collector: 'marketplace-listings',
      url: LISTINGS_URL,
      shape: 'listing',
      row_count: LISTINGS_BASELINE.row_count,
      match_threshold: GOLDEN_MATCH_THRESHOLD,
    });

    const { rows: counts } = await db.query<{ collectors: number; baselines: number }>(
      `select (select count(*)::int from collectors)       as collectors,
              (select count(*)::int from golden_baselines) as baselines`,
    );
    log.info('seed complete', counts[0] ?? {});
    return 0;
  } catch (error) {
    log.error('seed failed', { error });
    return 1;
  } finally {
    await pool.end();
  }
}

process.exitCode = await main();
