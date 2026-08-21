import {
  ATTEMPT_DECISIONS,
  COLLECTOR_STATUSES,
  EPISODE_AUTHORISERS,
  EPISODE_FINAL_STATES,
  EPISODE_TRIGGER_REASONS,
  JOB_KINDS,
  JOB_STATES,
  RUN_STATES,
} from '@weaver/contracts';

/**
 * The schema, as the model is told about it.
 *
 * Written by hand rather than introspected at request time, for two reasons. The model needs to
 * know what a column MEANS — that `fhs` is penalty-adjusted, that `runs.rows` holds the CLI's output
 * verbatim including duplicates — and `information_schema` does not carry that. And a prompt
 * assembled per request is a prompt nobody has read.
 *
 * The cost of writing it by hand is drift, so `test/schema.test.mjs` applies the real migrations to
 * a real Postgres and checks this description against them in BOTH directions: no column described
 * here that does not exist, and no column in those six tables that is not described here. A model
 * told about a column that was renamed writes queries that fail; a model not told about a new one
 * cannot answer questions about it and will not say why.
 *
 * The enum values come from `@weaver/contracts`, so a new run state reaches the prompt the moment
 * it reaches the state machine.
 */

export interface ColumnDoc {
  readonly name: string;
  readonly type: string;
  readonly note?: string;
}

export interface TableDoc {
  readonly name: string;
  readonly purpose: string;
  readonly columns: readonly ColumnDoc[];
}

export const SCHEMA: readonly TableDoc[] = [
  {
    name: 'collectors',
    purpose: 'One row per scraper. `id` is ours; `collector_id` is Bright Data\'s (c_…).',
    columns: [
      { name: 'id', type: 'uuid', note: 'primary key; every other table references THIS' },
      { name: 'workspace_id', type: 'uuid' },
      { name: 'collector_id', type: 'text', note: "Bright Data's own id, e.g. c_mt006kvtc12l54ywn" },
      { name: 'name', type: 'text' },
      { name: 'target_url', type: 'text' },
      { name: 'intent_prompt', type: 'text', note: 'what the user asked the collector to extract' },
      { name: 'contract', type: 'jsonb', note: 'validation contract: fields[], row_count, golden_set' },
      { name: 'status', type: 'text', note: COLLECTOR_STATUSES.join(' | ') },
      { name: 'created_at', type: 'timestamptz' },
    ],
  },
  {
    name: 'runs',
    purpose: 'One row per scrape. The main table for questions about data and health over time.',
    columns: [
      { name: 'id', type: 'uuid' },
      { name: 'collector_id', type: 'uuid', note: 'references collectors.id' },
      { name: 'job_id', type: 'uuid', note: 'null for runs not driven by the queue' },
      { name: 'started_at', type: 'timestamptz', note: 'order by this for "latest"' },
      { name: 'finished_at', type: 'timestamptz', note: 'null while a run is still in flight' },
      {
        name: 'rows',
        type: 'jsonb',
        note: 'array of scraped rows, EXACTLY as the CLI returned them — reserved word, always write "rows"',
      },
      { name: 'row_count', type: 'integer' },
      { name: 'fhs', type: 'numeric(7,6)', note: 'Field Health Score 0–1, penalty-adjusted; null while unscored' },
      { name: 'field_scores', type: 'jsonb', note: 'array of { field, fill_rate, type_pass, below_min_fill }' },
      { name: 'run_state', type: 'text', note: RUN_STATES.join(' | ') },
      { name: 'credits_spent', type: 'numeric(12,4)' },
    ],
  },
  {
    name: 'healing_episodes',
    purpose: 'One row per repair attempt on a collector — the healing ledger.',
    columns: [
      { name: 'id', type: 'uuid' },
      { name: 'collector_id', type: 'uuid' },
      { name: 'workspace_id', type: 'uuid' },
      { name: 'triggered_at', type: 'timestamptz' },
      { name: 'resolved_at', type: 'timestamptz', note: 'null while the episode is still running' },
      { name: 'final_state', type: 'text', note: `${EPISODE_FINAL_STATES.join(' | ')}; null = in progress` },
      { name: 'trigger_reason', type: 'text', note: EPISODE_TRIGGER_REASONS.join(' | ') },
      {
        name: 'authorised_by',
        type: 'text',
        note: `${EPISODE_AUTHORISERS.join(' | ')} — AUTONOMOUS iff trigger_reason = 'BROKEN'`,
      },
      { name: 'operator_prompted_at', type: 'timestamptz' },
      { name: 'operator_acted_at', type: 'timestamptz' },
      { name: 'fhs_before', type: 'numeric(7,6)' },
      { name: 'fhs_after', type: 'numeric(7,6)', note: 'set only when the episode reached RESTORED' },
      { name: 'failed_fields', type: 'jsonb', note: 'array of field names that fell below min_fill' },
      { name: 'snapshot_before', type: 'jsonb' },
      { name: 'snapshot_after', type: 'jsonb' },
      { name: 'credits_spent', type: 'numeric(12,4)' },
      { name: 'duration_ms', type: 'integer' },
      { name: 'attempt_count', type: 'integer', note: 'number of healing_attempts rows' },
    ],
  },
  {
    name: 'healing_attempts',
    purpose: 'One row per heal call inside an episode. Rejected attempts are kept, never deleted.',
    columns: [
      { name: 'id', type: 'uuid' },
      { name: 'episode_id', type: 'uuid', note: 'references healing_episodes.id' },
      { name: 'attempt_no', type: 'integer', note: 'starts at 1' },
      { name: 'description_sent', type: 'text', note: 'the diagnosis sent to the healer, verbatim' },
      { name: 'canary_sample', type: 'jsonb', note: 'the preview rows the repair produced' },
      { name: 'canary_fhs', type: 'numeric(7,6)', note: 'the canary score; the approval gate is 0.90' },
      { name: 'decision', type: 'text', note: `${ATTEMPT_DECISIONS.join(' | ')}; null while at the gate` },
      { name: 'rejection_reason', type: 'text' },
      { name: 'cli_argv_redacted', type: 'text', note: 'the exact command, API key redacted' },
      { name: 'stderr_excerpt', type: 'text' },
      { name: 'created_at', type: 'timestamptz' },
    ],
  },
  {
    name: 'golden_baselines',
    purpose: 'The regression set a repair must reproduce before it is called RESTORED.',
    columns: [
      { name: 'id', type: 'uuid' },
      { name: 'collector_id', type: 'uuid' },
      { name: 'url', type: 'text' },
      { name: 'baseline_row', type: 'jsonb' },
      { name: 'shape', type: 'text', note: 'detail | listing' },
      { name: 'captured_at', type: 'timestamptz' },
    ],
  },
  {
    name: 'jobs',
    purpose: 'The work queue. Mostly operational; questions about data usually want `runs` instead.',
    columns: [
      { name: 'id', type: 'uuid' },
      { name: 'collector_id', type: 'uuid' },
      { name: 'kind', type: 'text', note: JOB_KINDS.join(' | ') },
      { name: 'state', type: 'text', note: JOB_STATES.join(' | ') },
      { name: 'attempts', type: 'integer' },
      { name: 'scheduled_for', type: 'timestamptz' },
      { name: 'claimed_at', type: 'timestamptz' },
      { name: 'claimed_by', type: 'text' },
      { name: 'error', type: 'text' },
    ],
  },
];

/**
 * The scraped row shape, which is where most questions actually point.
 *
 * A question like "which products got cheaper" is not answerable from a column — the products live
 * inside `runs.rows` as jsonb, and getting at them takes `jsonb_array_elements`. Without this, a
 * model writes `select product_name from runs`, which is a column that does not exist, and the user
 * sees a database error instead of an answer.
 */
const ROW_SHAPE = `
Scraped rows live inside runs."rows" as a jsonb array. One element looks like:

  {
    "product_name": "AeroBook Pro 14",
    "price": { "value": 1299, "currency": "USD", "symbol": "$" },
    "ram": "16 GB",
    "storage": "512 GB",
    "in_stock": true,
    "product_page_url": "https://…"
  }

To query them, unnest:

  select item->>'product_name' as product_name,
         (item->'price'->>'value')::numeric as price
    from runs, jsonb_array_elements(runs."rows") as item
   where runs.collector_id = $1

Two things to know about that array:

  * It contains DUPLICATES. The ledger stores what the collector returned, verbatim, and the live
    collector emits every product several times. Use "select distinct" on the product fields.
  * The field names come from the collector's contract, so they vary between collectors. The example
    above is the marketplace-listings collector.
`.trim();

/** The schema section of the system prompt. */
export function schemaPrompt(): string {
  const tables = SCHEMA.map((table) => {
    const columns = table.columns
      .map((column) => `    ${column.name} ${column.type}${column.note ? `  -- ${column.note}` : ''}`)
      .join('\n');
    return `  ${table.name} — ${table.purpose}\n${columns}`;
  }).join('\n\n');

  return `${tables}\n\n${ROW_SHAPE}`;
}
