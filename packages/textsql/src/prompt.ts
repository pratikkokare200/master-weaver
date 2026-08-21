import { schemaPrompt } from './schema.js';
import { DEFAULT_ROW_LIMIT } from './guard.js';

/**
 * The system prompt.
 *
 * A prompt is not a security boundary and nothing here is written as though it were — the guard and
 * the read-only role are what stop a write, and both hold whether or not the model reads this. What
 * this is for is accuracy: telling the model where the data actually is, so it stops writing
 * `select product_name from runs` against a table that has no such column.
 *
 * The collector id is bound as a parameter rather than interpolated, and the prompt says so, so a
 * question that mentions another collector's name cannot widen the query beyond the page the user
 * is looking at.
 */

export interface PromptOptions {
  /** Named so the model can talk about it in the answer. */
  readonly collectorName: string;
  readonly limit?: number;
}

export function systemPrompt(options: PromptOptions): string {
  const limit = options.limit ?? DEFAULT_ROW_LIMIT;

  return `You translate questions about a web-scraping ledger into a single PostgreSQL query.

The user is looking at one collector: "${options.collectorName}". Its id is available as the bound
parameter $1. ALWAYS filter by it — write "where collector_id = $1", never a literal uuid and never
the collector's name. Questions are about this collector only.

SCHEMA

${schemaPrompt()}

RULES

1. Return exactly one statement. It must be a SELECT (a WITH … SELECT is fine). No semicolon.
2. No INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, GRANT, SET or COPY. The connection is read-only
   and the query will be rejected before it runs.
3. Use $1 for the collector id. It is the only parameter available.
4. Timestamps are timestamptz in UTC. Use "now() - interval '1 day'" for relative time.
5. fhs is numeric between 0 and 1: HEALTHY ≥ 0.95, DEGRADED 0.60–0.95, BROKEN < 0.60.
6. At most ${limit} rows come back. Add your own smaller LIMIT when the question implies one
   ("the three cheapest").
7. Prefer aggregation over returning raw rows. "How many times did it break" is a count, not a list.
8. If the question cannot be answered from this schema, return the single word: CANNOT_ANSWER

RESPONSE FORMAT

Reply with JSON and nothing else:

{"sql": "select …", "explanation": "one sentence saying what the query does"}

Return CANNOT_ANSWER as the value of "sql" if rule 8 applies.`;
}

/**
 * Pull the query out of a model response.
 *
 * Models wrap JSON in prose and in fenced code blocks despite being asked not to, so this reads
 * what arrives rather than what was requested. Failing here is not an error worth surfacing as a
 * stack trace — it is a normal, retryable outcome of talking to a language model.
 */
export interface ParsedAnswer {
  readonly sql: string | null;
  readonly explanation: string | null;
  /** True when the model said the question is unanswerable from this schema. */
  readonly cannotAnswer: boolean;
}

const FENCE = /```(?:json|sql)?\s*([\s\S]*?)```/i;

export function parseAnswer(raw: string): ParsedAnswer {
  const text = (FENCE.exec(raw)?.[1] ?? raw).trim();

  let sql: string | null = null;
  let explanation: string | null = null;

  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed !== null && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>;
      if (typeof record['sql'] === 'string') sql = record['sql'];
      if (typeof record['explanation'] === 'string') explanation = record['explanation'];
    }
  } catch {
    // Not JSON. If the whole reply is a query, take it: a correct answer in the wrong wrapper is
    // still a correct answer, and the guard checks it either way.
    if (/^\s*(select|with)\b/i.test(text)) sql = text;
  }

  const trimmed = sql?.trim() ?? '';
  if (trimmed === '' || /^CANNOT_ANSWER$/i.test(trimmed)) {
    return { sql: null, explanation, cannotAnswer: /CANNOT_ANSWER/i.test(raw) };
  }

  return { sql: trimmed, explanation, cannotAnswer: false };
}
