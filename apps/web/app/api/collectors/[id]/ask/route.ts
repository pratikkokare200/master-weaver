import {
  UnsafeSqlError,
  assertReadOnlySql,
  parseAnswer,
  systemPrompt,
} from '@weaver/textsql';

import { isUuid } from '@/lib/db.server';
import { GroqError, chat, isGroqConfigured } from '@/lib/groq.server';
import { getCollectorName } from '@/lib/queries.server';
import { NotConfiguredError, runGeneratedQuery } from '@/lib/readonly.server';

/**
 * Text-to-SQL — `POST /api/collectors/<id>/ask`.
 *
 * A question in, a query and an answer out. The query is always returned and the panel always shows
 * it: an answer whose derivation is hidden is a claim, and this product is about not making claims
 * that cannot be checked.
 *
 * The sequence:
 *
 *   1. Groq turns the question into one statement, told the schema and told to bind `$1`.
 *   2. `assertReadOnlySql` refuses anything that is not a single read.
 *   3. The statement runs as `weaver_readonly` inside a read-only transaction, wrapped in a limit.
 *   4. Groq summarises the rows it got back — and only those rows.
 *
 * Steps 2 and 3 are independent defences: a string check, and a role that has no write privilege.
 * Neither is sufficient alone, which is why both are here (ADR-004).
 *
 * ⚠️ Unauthenticated and unmetered, like the rest of v1. A caller can spend Groq tokens by asking
 * questions in a loop. Rate limiting belongs in front of this and does not exist yet.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Long enough for a real question, short enough that the prompt is not a place to paste an essay. */
const MAX_QUESTION_CHARS = 500;

/** Rows handed to the summarising call. Enough to characterise an answer, not enough to bury it. */
const ROWS_FOR_SUMMARY = 40;

interface AskResponse {
  answer: string;
  sql: string | null;
  columns: string[];
  rows: Record<string, unknown>[];
  /** True when the query returned more rows than the answer was written from. */
  truncated: boolean;
}

function fail(message: string, status: number, sql?: string): Response {
  return Response.json({ error: message, sql: sql ?? null }, { status });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  if (!isUuid(id)) return fail('not a collector id', 404);

  let question: unknown;
  try {
    const body: unknown = await request.json();
    question = (body as { question?: unknown } | null)?.question;
  } catch {
    return fail('expected a JSON body', 400);
  }

  if (typeof question !== 'string' || question.trim() === '') {
    return fail('ask a question', 400);
  }
  if (question.length > MAX_QUESTION_CHARS) {
    return fail(`questions are limited to ${MAX_QUESTION_CHARS} characters`, 400);
  }

  // Said plainly and early. "Not configured" is a different thing from "broken", and a panel that
  // reports a 500 for a missing environment variable sends someone reading logs for an hour.
  if (!isGroqConfigured()) {
    return fail('text-to-SQL is not configured: GROQ_API_KEY is not set', 501);
  }

  const collectorName = await getCollectorName(id);
  if (collectorName === null) return fail('no such collector', 404);

  // ---------------------------------------------------------------------------------------------
  // 1 · Question to SQL
  // ---------------------------------------------------------------------------------------------

  let raw: string;
  try {
    raw = await chat({
      json: true,
      messages: [
        { role: 'system', content: systemPrompt({ collectorName }) },
        { role: 'user', content: question },
      ],
    });
  } catch (error) {
    const groq = error instanceof GroqError ? error : null;
    return fail(groq?.message ?? 'the query service could not be reached', groq?.status ?? 502);
  }

  const parsed = parseAnswer(raw);

  if (parsed.cannotAnswer || parsed.sql === null) {
    // Not an error. "That cannot be answered from this data" is a good answer, and dressing it up
    // as a failure would push someone into rephrasing a question that has no answer here.
    return Response.json({
      answer:
        parsed.explanation ??
        'That question cannot be answered from this collector’s ledger.',
      sql: null,
      columns: [],
      rows: [],
      truncated: false,
    } satisfies AskResponse);
  }

  // ---------------------------------------------------------------------------------------------
  // 2 · The guard
  // ---------------------------------------------------------------------------------------------

  let safe;
  try {
    safe = assertReadOnlySql(parsed.sql);
  } catch (error) {
    if (error instanceof UnsafeSqlError) {
      // The refused query is returned deliberately. A guard that hides what it blocked is one
      // nobody can audit, and seeing the statement is how a user tells a false positive from a
      // genuine refusal.
      return fail(`the generated query was refused: ${error.message}`, 422, parsed.sql);
    }
    throw error;
  }

  // ---------------------------------------------------------------------------------------------
  // 3 · Run it
  // ---------------------------------------------------------------------------------------------

  let result;
  try {
    result = await runGeneratedQuery(safe.executable, [id]);
  } catch (error) {
    if (error instanceof NotConfiguredError) return fail(error.message, 501, safe.sql);

    // A generated query that does not run is the ordinary case, not an exception: the model
    // referenced a column that does not exist, or wrote a type it cannot cast. The message from
    // Postgres is the most useful thing to show, alongside the query it came from.
    const message = error instanceof Error ? error.message : 'the query could not be run';
    return fail(`the query failed: ${message}`, 422, safe.sql);
  }

  // ---------------------------------------------------------------------------------------------
  // 4 · Rows to an answer
  // ---------------------------------------------------------------------------------------------

  const sample = result.rows.slice(0, ROWS_FOR_SUMMARY);
  let answer = parsed.explanation ?? 'Here is what the query returned.';

  if (result.rows.length === 0) {
    answer = 'The query ran and returned no rows.';
  } else {
    try {
      answer = (
        await chat({
          maxTokens: 300,
          messages: [
            {
              role: 'system',
              content:
                'Answer the question from the rows given, in at most three sentences. Use only ' +
                'these rows — do not add figures that are not in them, and do not describe the ' +
                'query. If the rows do not answer the question, say so.',
            },
            {
              role: 'user',
              content: `Question: ${question}\n\nRows (${result.rows.length} returned${
                result.rows.length > sample.length ? `, first ${sample.length} shown` : ''
              }):\n${JSON.stringify(sample)}`,
            },
          ],
        })
      ).trim();
    } catch {
      // The summary is the presentation layer; the rows and the query are the substance. If the
      // second call fails, the first call's own explanation stands in and nothing is lost.
    }
  }

  return Response.json({
    answer,
    sql: safe.sql,
    columns: [...result.columns],
    rows: result.rows.slice(0, 100) as Record<string, unknown>[],
    truncated: result.rows.length >= safe.limit,
  } satisfies AskResponse);
}
