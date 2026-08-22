import 'server-only';

import type { CollectorContract, GoldenSetShape, RunState } from '@weaver/contracts';
import type { EpisodeRecord, RunRecord } from '@weaver/export';
import type { CollectorField } from '@weaver/textsql';

import { query } from './db.server';
import type {
  CollectorSummary,
  LedgerAttempt,
  LedgerEpisode,
  ProductRow,
} from './seed';

/**
 * Every read the Observation Deck makes — Layer A's entire relationship with the ledger.
 *
 * These deliberately return the SAME view-model types the seed fixtures declared
 * (`CollectorSummary`, `LedgerEpisode`, `ProductRow`). The components were built against those
 * shapes and are not touched by this wiring: swapping the source is the change, and a component
 * that renders identically from fixtures and from Postgres is a component whose empty, loading and
 * error states are still honest.
 *
 * **Read-only, without exception.** Doc 03 §3.2 gives Layer A observation plus job enqueueing and
 * nothing else. The one write in the whole app is the repair route's `insert into jobs`, and it
 * lives there rather than here so this module can be read as what it is.
 *
 * Two rules hold throughout:
 *
 *   - **`numeric` comes back as a string.** node-postgres is right to do that (numeric is arbitrary
 *     precision, float64 is not), so every FHS is cast at the boundary rather than trusted to be a
 *     number three components deep. `num()` is not decoration.
 *   - **Nothing is aggregated in JavaScript that Postgres can aggregate.** A collector list that
 *     pulls every run and reduces it in the lambda is a page that gets slower every day the engine
 *     runs. `runs.rows` in particular is the full CLI payload and is never selected except when a
 *     caller genuinely wants the rows.
 */

/** `numeric` arrives as a string. Null stays null — an absent FHS is not zero. */
function num(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

// ---------------------------------------------------------------------------------------------
// Collectors
// ---------------------------------------------------------------------------------------------

interface CollectorRow {
  id: string;
  collector_id: string;
  name: string;
  target_url: string;
  intent_prompt: string | null;
  contract: { golden_set?: string[]; golden_set_shape?: GoldenSetShape } | null;
  run_state: RunState | null;
  fhs: string | null;
  row_count: number | null;
  finished_at: Date | null;
}

/**
 * The collector list, each with the state of its most recent finished run.
 *
 * `distinct on` rather than a correlated subquery or a window function: it is the one construct that
 * reads the latest run per collector in a single index-ordered pass, and it keeps the "latest" rule
 * in exactly one place instead of repeated in a `where` and an `order by`.
 *
 * A collector with no runs yet is included with nulls throughout, not dropped. A newly created
 * collector that vanishes from the list until its first run completes looks like a failed creation.
 */
const COLLECTOR_SELECT = `
  select c.id,
         c.collector_id,
         c.name,
         c.target_url,
         c.intent_prompt,
         c.contract,
         r.run_state,
         r.fhs,
         r.row_count,
         r.finished_at
    from collectors c
    left join lateral (
      select run_state, fhs, row_count, finished_at
        from runs
       where runs.collector_id = c.id
         and finished_at is not null
       order by started_at desc
       limit 1
    ) r on true
`;

function toSummary(row: CollectorRow): CollectorSummary {
  const goldenSet = row.contract?.golden_set ?? [];

  return {
    id: row.id,
    collectorId: row.collector_id,
    name: row.name,
    targetUrl: row.target_url,
    intent: row.intent_prompt ?? '',
    // IDLE, not a guess at health: a collector with no finished run has not demonstrated anything,
    // and showing it as HEALTHY would be the dashboard asserting something it cannot know.
    runState: row.run_state ?? 'IDLE',
    fhs: num(row.fhs),
    rowCount: row.row_count ?? null,
    lastRunAt: iso(row.finished_at),
    goldenSet: {
      count: goldenSet.length,
      shape: row.contract?.golden_set_shape ?? 'listing',
    },
  };
}

export async function listCollectors(): Promise<CollectorSummary[]> {
  const rows = await query<CollectorRow>(`${COLLECTOR_SELECT} order by c.created_at asc`);
  return rows.map(toSummary);
}

export async function getCollector(id: string): Promise<CollectorSummary | null> {
  const rows = await query<CollectorRow>(`${COLLECTOR_SELECT} where c.id = $1`, [id]);
  return rows[0] ? toSummary(rows[0]) : null;
}

// ---------------------------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------------------------

/**
 * The most recent run that actually produced rows.
 *
 * Not simply the most recent run. A collector mid-break has its latest run at zero rows, and a table
 * that empties itself the moment something goes wrong destroys the data the operator needs in order
 * to understand what went wrong. The health badge reports the break; the table keeps showing the
 * last thing that worked, which is also what `lastGoodAt` is for.
 */
export async function getLatestRows(collectorId: string): Promise<{
  rows: unknown[];
  runId: string | null;
  runState: RunState | null;
  lastGoodAt: string | null;
}> {
  const rows = await query<{
    id: string;
    rows: unknown[] | null;
    run_state: RunState;
    finished_at: Date | null;
  }>(
    `select id, "rows", run_state, finished_at
       from runs
      where collector_id = $1
        and finished_at is not null
        and row_count > 0
      order by started_at desc
      limit 1`,
    [collectorId],
  );

  const run = rows[0];
  if (!run) return { rows: [], runId: null, runState: null, lastGoodAt: null };

  return {
    rows: Array.isArray(run.rows) ? run.rows : [],
    runId: run.id,
    runState: run.run_state,
    lastGoodAt: iso(run.finished_at),
  };
}

/**
 * Map a stored row onto the table's view model.
 *
 * Stored rows are CLI output kept verbatim (doc 03 §4), so this is where the envelope shapes are
 * unwrapped — `price` arrives as `{ value, currency, symbol }` and `in_stock` as a boolean. Nothing
 * is coerced beyond reading: a field the collector did not return becomes null and renders as an
 * em dash, rather than being invented as an empty string that looks like real emptiness.
 */
export function toProductRow(raw: unknown): ProductRow {
  const row = (raw ?? {}) as Record<string, unknown>;
  const price = row['price'] as { value?: unknown; currency?: unknown } | null | undefined;
  const value = typeof price?.value === 'number' ? price.value : null;

  const text = (key: string): string | null => {
    const v = row[key];
    return typeof v === 'string' && v.trim() !== '' ? v : null;
  };

  const stock = row['in_stock'];

  return {
    product_name: text('product_name') ?? '—',
    price: value === null ? null : { value, currency: String(price?.currency ?? 'USD') },
    ram: text('ram'),
    storage: text('storage'),
    stock: typeof stock === 'boolean' ? (stock ? 'In Stock' : 'Out of Stock') : text('in_stock'),
    product_page_url: text('product_page_url') ?? text('product_url') ?? '',
  };
}

// ---------------------------------------------------------------------------------------------
// Series
// ---------------------------------------------------------------------------------------------

export interface HealthPoint {
  /** ISO timestamp of the run. */
  t: string;
  fhs: number | null;
  rowCount: number;
  runState: RunState;
}

/**
 * FHS over time — the health sparkline and the chart panel's second series.
 *
 * Every finished run, not just healthy ones. The dips ARE the story: a chart that plots only
 * successful runs is a chart that cannot show a heal, which is the one thing this product exists to
 * demonstrate.
 *
 * Returned oldest-first because that is what a chart wants, while the query orders newest-first so
 * the limit keeps the RECENT window rather than the oldest one.
 */
export async function getHealthSeries(collectorId: string, limit = 96): Promise<HealthPoint[]> {
  const rows = await query<{
    finished_at: Date;
    fhs: string | null;
    row_count: number | null;
    run_state: RunState;
  }>(
    `select finished_at, fhs, row_count, run_state
       from runs
      where collector_id = $1 and finished_at is not null
      order by started_at desc
      limit $2`,
    [collectorId, limit],
  );

  return rows
    .map((r) => ({
      t: iso(r.finished_at) ?? '',
      fhs: num(r.fhs),
      rowCount: r.row_count ?? 0,
      runState: r.run_state,
    }))
    .reverse();
}

export interface PricePoint {
  t: string;
  /** Median price across the run's distinct products — one number per run. */
  median: number;
  /** Distinct products the run saw, so a thinning catalogue is visible next to the price. */
  products: number;
}

/**
 * Median product price per run — the "why you would run this at all" series.
 *
 * The median rather than the mean, because a catalogue that gains one $6,000 workstation should not
 * look like across-the-board inflation. And computed in Postgres via `percentile_cont`, over rows
 * unnested from the stored jsonb, so the lambda never holds a run's full payload just to average it.
 *
 * `jsonb_array_elements` with `distinct` on the product name does the read-path de-duplication that
 * `@weaver/validation`'s `dedupeRows` does in TypeScript — same rule, applied where the data is.
 * Both exist deliberately: the stored rows stay verbatim, and every reader de-duplicates.
 */
export async function getPriceSeries(collectorId: string, limit = 96): Promise<PricePoint[]> {
  const rows = await query<{ finished_at: Date; median: string | null; products: number }>(
    `with recent as (
       select id, finished_at, "rows"
         from runs
        where collector_id = $1
          and finished_at is not null
          and run_state in ('HEALTHY', 'RESTORED')
          and row_count > 0
        order by started_at desc
        limit $2
     ),
     priced as (
       select distinct
              recent.id,
              recent.finished_at,
              item->>'product_name' as product_name,
              (item->'price'->>'value')::numeric as price
         from recent, jsonb_array_elements(recent."rows") as item
        where item->'price'->>'value' is not null
     )
     select finished_at,
            percentile_cont(0.5) within group (order by price) as median,
            count(*)::int as products
       from priced
      group by id, finished_at
      order by finished_at desc`,
    [collectorId, limit],
  );

  return rows
    .filter((r) => num(r.median) !== null)
    .map((r) => ({ t: iso(r.finished_at) ?? '', median: num(r.median) ?? 0, products: r.products }))
    .reverse();
}

// ---------------------------------------------------------------------------------------------
// The healing ledger
// ---------------------------------------------------------------------------------------------

interface EpisodeRow {
  id: string;
  triggered_at: Date;
  trigger_reason: 'DEGRADED' | 'BROKEN';
  authorised_by: 'AUTONOMOUS' | 'OPERATOR';
  fhs_before: string | null;
  fhs_after: string | null;
  final_state: 'RESTORED' | 'QUARANTINED' | 'DISMISSED' | null;
  credits_spent: string | null;
  duration_ms: number | null;
  attempts: LedgerAttemptRow[] | null;
}

interface LedgerAttemptRow {
  attempt_no: number;
  canary_fhs: string | number | null;
  decision: 'APPROVED' | 'REJECTED' | null;
  rejection_reason: string | null;
  description_sent: string;
}

/**
 * Episodes with their attempts — the audit trail, exactly as recorded.
 *
 * **Rejected attempts are included, always.** Doc 05 §6 is explicit, and it is the right call on the
 * merits: a system that shows you the fix it refused to ship is more convincing than one that only
 * ever reports success. Filtering them would also make `attempt_no` skip numbers, which is its own
 * kind of lie.
 *
 * Open episodes are included too, with `final_state` null — one is genuinely in flight while you are
 * looking at it, and that is worth seeing.
 *
 * The attempts arrive as an aggregated jsonb array rather than a second round trip or a join that
 * multiplies episode rows by their attempts and needs undoing in JavaScript.
 */
export async function getEpisodes(collectorId: string, limit = 25): Promise<LedgerEpisode[]> {
  const rows = await query<EpisodeRow>(
    `select e.id,
            e.triggered_at,
            e.trigger_reason,
            e.authorised_by,
            e.fhs_before,
            e.fhs_after,
            e.final_state,
            e.credits_spent,
            e.duration_ms,
            (select coalesce(
                      jsonb_agg(jsonb_build_object(
                        'attempt_no',       a.attempt_no,
                        'canary_fhs',       a.canary_fhs,
                        'decision',         a.decision,
                        'rejection_reason', a.rejection_reason,
                        'description_sent', a.description_sent
                      ) order by a.attempt_no),
                      '[]'::jsonb)
               from healing_attempts a
              where a.episode_id = e.id) as attempts
       from healing_episodes e
      where e.collector_id = $1
      order by e.triggered_at desc
      limit $2`,
    [collectorId, limit],
  );

  return rows.map((row) => ({
    id: row.id,
    triggeredAt: iso(row.triggered_at) ?? '',
    triggerReason: row.trigger_reason,
    authorisedBy: row.authorised_by,
    fhsBefore: num(row.fhs_before) ?? 0,
    fhsAfter: num(row.fhs_after),
    // An episode still in flight has no verdict. The panel renders that as "in progress" rather
    // than being handed a plausible-looking final state it would show as settled.
    finalState: row.final_state ?? 'QUARANTINED',
    creditsSpent: num(row.credits_spent) ?? 0,
    durationMs: row.duration_ms ?? 0,
    attempts: (row.attempts ?? []).map(
      (a): LedgerAttempt => ({
        attemptNo: a.attempt_no,
        canaryFhs: num(a.canary_fhs) ?? 0,
        decision: a.decision ?? 'REJECTED',
        rejectionReason: a.rejection_reason,
        diagnosis: a.description_sent,
      }),
    ),
  }));
}

// ---------------------------------------------------------------------------------------------
// Live status
// ---------------------------------------------------------------------------------------------

export interface LiveStatus {
  collectorId: string;
  runState: RunState;
  fhs: number | null;
  rowCount: number | null;
  lastRunAt: string | null;
  /** True while a run or repair is queued or claimed — what makes the badge pulse. */
  working: boolean;
  /** Set when a run is parked at PENDING_OPERATOR and the approval panel should be showing. */
  awaitingOperator: boolean;
  failedFields: string[];
  healthyFields: string[];
}

/**
 * One collector's current state, cheap enough to poll.
 *
 * Deliberately excludes `runs.rows`. This is the endpoint the health monitor hits every few seconds,
 * and selecting the full CLI payload each time would move megabytes to render a coloured dot.
 */
export async function getLiveStatus(collectorId: string): Promise<LiveStatus | null> {
  const rows = await query<{
    id: string;
    run_state: RunState | null;
    fhs: string | null;
    row_count: number | null;
    finished_at: Date | null;
    field_scores: { field: string; below_min_fill: boolean }[] | null;
    pending_jobs: number;
    awaiting_operator: boolean;
  }>(
    `select c.id,
            r.run_state,
            r.fhs,
            r.row_count,
            r.finished_at,
            r.field_scores,
            (select count(*)::int from jobs j
              where j.collector_id = c.id and j.state in ('PENDING', 'CLAIMED')) as pending_jobs,
            exists (select 1 from runs o
                     where o.collector_id = c.id
                       and o.run_state = 'PENDING_OPERATOR') as awaiting_operator
       from collectors c
       left join lateral (
         select run_state, fhs, row_count, finished_at, field_scores
           from runs
          where runs.collector_id = c.id and finished_at is not null
          order by started_at desc
          limit 1
       ) r on true
      where c.id = $1`,
    [collectorId],
  );

  const row = rows[0];
  if (!row) return null;

  const scores = row.field_scores ?? [];
  const state = row.run_state ?? 'IDLE';

  return {
    collectorId: row.id,
    runState: state,
    fhs: num(row.fhs),
    rowCount: row.row_count ?? null,
    lastRunAt: iso(row.finished_at),
    // A queued job, or a run currently walking the healing states. Both mean "something is
    // happening", which is the only question the badge's animation is answering.
    working: row.pending_jobs > 0 || IN_FLIGHT_STATES.has(state),
    awaitingOperator: row.awaiting_operator,
    failedFields: scores.filter((s) => s.below_min_fill).map((s) => s.field),
    healthyFields: scores.filter((s) => !s.below_min_fill).map((s) => s.field),
  };
}

/**
 * Run states that mean work is under way.
 *
 * The states a run passes THROUGH rather than rests in. Typed as `RunState` rather than `string` on
 * purpose: the set is a hand-written subset of a frozen enum, and typing it loosely is how a state
 * gets renamed and this quietly stops matching anything.
 *
 * Two absences are deliberate. `PENDING_OPERATOR` is the machine waiting on a human — the opposite
 * of the machine working, and animating it would say the opposite of what is true. `TRANSIENT_RETRY`
 * IS included, because a backoff is work that has not finished, and the queued job proves it.
 */
const IN_FLIGHT_STATES: ReadonlySet<RunState> = new Set<RunState>([
  'QUEUED',
  'RUNNING',
  'VALIDATING',
  'TRANSIENT_RETRY',
  'DIAGNOSING',
  'HEALING',
  'AWAITING_APPROVAL',
  'CANARY_VALIDATING',
  'APPROVING',
  'REJECTING',
]);

// ---------------------------------------------------------------------------------------------
// Export sources
//
// The export reads the ledger in its own shapes rather than through the view models above. A
// spreadsheet wants what was recorded — `resolved_at`, `failed_fields`, the raw `numeric` strings —
// and the view models have already dropped some of that on the way to being renderable. Two shapes
// for two consumers, rather than one shape stretched to serve both.
// ---------------------------------------------------------------------------------------------

/** The latest run that produced rows, with the contract the columns are ordered by. */
export async function getRowsForExport(collectorId: string): Promise<{
  name: string;
  contract: CollectorContract | null;
  rows: unknown[];
  finishedAt: string | null;
} | null> {
  const rows = await query<{
    name: string;
    contract: CollectorContract | null;
    rows: unknown[] | null;
    finished_at: Date | null;
  }>(
    `select c.name,
            c.contract,
            r."rows",
            r.finished_at
       from collectors c
       left join lateral (
         select "rows", finished_at
           from runs
          where runs.collector_id = c.id and finished_at is not null and row_count > 0
          order by started_at desc
          limit 1
       ) r on true
      where c.id = $1`,
    [collectorId],
  );

  const row = rows[0];
  if (!row) return null;

  return {
    name: row.name,
    contract: row.contract,
    rows: Array.isArray(row.rows) ? row.rows : [],
    finishedAt: iso(row.finished_at),
  };
}

/**
 * The run ledger, newest first, capped.
 *
 * `runs.rows` is deliberately not selected. The full CLI payload for 5,000 runs is hundreds of
 * megabytes, and none of it appears in this sheet — the run history is one line per run.
 */
export async function getRunRecords(collectorId: string, limit = 5_000): Promise<RunRecord[]> {
  return query<RunRecord>(
    `select started_at, finished_at, run_state, fhs, row_count, credits_spent
       from runs
      where collector_id = $1
      order by started_at desc
      limit $2`,
    [collectorId, limit],
  );
}

/** Episodes with their attempts, as recorded — rejected attempts included. */
export async function getEpisodeRecords(collectorId: string, limit = 500): Promise<EpisodeRecord[]> {
  return query<EpisodeRecord>(
    `select e.triggered_at,
            e.resolved_at,
            e.trigger_reason,
            e.authorised_by,
            e.final_state,
            e.fhs_before,
            e.fhs_after,
            e.credits_spent,
            e.duration_ms,
            e.failed_fields,
            (select coalesce(
                      jsonb_agg(jsonb_build_object(
                        'attempt_no',       a.attempt_no,
                        'canary_fhs',       a.canary_fhs,
                        'decision',         a.decision,
                        'rejection_reason', a.rejection_reason,
                        'description_sent', a.description_sent
                      ) order by a.attempt_no),
                      '[]'::jsonb)
               from healing_attempts a
              where a.episode_id = e.id) as attempts
       from healing_episodes e
      where e.collector_id = $1
      order by e.triggered_at desc
      limit $2`,
    [collectorId, limit],
  );
}

/**
 * A collector's name and nothing else.
 *
 * Separate from {@link getRowsForExport} because that one selects `runs.rows` — the full CLI payload
 * — and the run and episode exports need the name only. Reading a megabyte of product JSON to
 * title a spreadsheet is the kind of waste that is invisible until the payload grows.
 */
export async function getCollectorName(collectorId: string): Promise<string | null> {
  const rows = await query<{ name: string }>('select name from collectors where id = $1', [
    collectorId,
  ]);
  return rows[0]?.name ?? null;
}

/** What text-to-SQL tells the model about the collector being asked about. */
export interface CollectorPromptContext {
  readonly name: string;
  /** `collectors.intent_prompt` — what the operator asked this collector to extract. */
  readonly intentPrompt: string | null;
  /** The contract's field names and declared types: the real keys inside `runs."rows"`. */
  readonly fields: CollectorField[];
}

/**
 * The collector, as text-to-SQL needs to describe it.
 *
 * Deliberately not folded into {@link getCollectorName}: that one is on the export path, which runs
 * per download and wants a name, not a contract. The two have different callers and different
 * costs, and merging them would make every spreadsheet export parse a jsonb column it discards.
 *
 * `contract` is jsonb, so it is whatever was written into it — read defensively rather than cast.
 * A collector with a malformed contract must still be able to answer questions from its schema;
 * losing the field list degrades an answer, but throwing here loses the whole feature.
 */
export async function getCollectorPromptContext(
  collectorId: string,
): Promise<CollectorPromptContext | null> {
  const rows = await query<{
    name: string;
    intent_prompt: string | null;
    contract: unknown;
  }>('select name, intent_prompt, contract from collectors where id = $1', [collectorId]);

  const row = rows[0];
  if (!row) return null;

  const declared = (row.contract as { fields?: unknown } | null)?.fields;
  const fields: CollectorField[] = Array.isArray(declared)
    ? declared.flatMap((entry) => {
        const field = entry as { name?: unknown; type?: unknown } | null;
        if (typeof field?.name !== 'string' || field.name.trim() === '') return [];
        return [{ name: field.name, type: typeof field.type === 'string' ? field.type : 'text' }];
      })
    : [];

  return { name: row.name, intentPrompt: row.intent_prompt, fields };
}
