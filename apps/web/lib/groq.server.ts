import 'server-only';

/**
 * Groq, over its OpenAI-compatible endpoint.
 *
 * No SDK. This is one POST with a JSON body — a client library would add a dependency, a version to
 * track and an abstraction over exactly one call, and it would still be `fetch` underneath.
 *
 * Two things it does that are easy to leave out and expensive to leave out: it aborts, so a slow
 * model cannot hold a Vercel function open until the platform kills it, and it never puts the API
 * key anywhere but the Authorization header — not in a log line, not in an error message.
 */

const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

/**
 * The default model.
 *
 * A 70B model, because writing correct SQL against an unfamiliar schema is where smaller models
 * start inventing column names — and an invented column is a database error shown to a user, not a
 * slightly worse answer. Overridable through `GROQ_MODEL` without a deploy.
 */
const DEFAULT_MODEL = 'llama-3.3-70b-versatile';

/** Long enough for a 70B model to answer, short enough to stay inside a serverless request. */
const TIMEOUT_MS = 15_000;

export class GroqError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'GroqError';
    this.status = status;
  }
}

export interface ChatMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

export interface ChatOptions {
  readonly messages: readonly ChatMessage[];
  /** Ask for a JSON object back. Off for the summarising call, which answers in prose. */
  readonly json?: boolean;
  readonly maxTokens?: number;
}

export function isGroqConfigured(): boolean {
  return Boolean(process.env['GROQ_API_KEY']);
}

export async function chat(options: ChatOptions): Promise<string> {
  const key = process.env['GROQ_API_KEY'];
  if (!key) throw new GroqError(501, 'GROQ_API_KEY is not set');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: process.env['GROQ_MODEL'] ?? DEFAULT_MODEL,
        messages: options.messages,
        // Zero, because this is a translation task with a right answer. A question asked twice
        // should produce the same query — otherwise the SQL shown under the answer stops being a
        // reliable account of how the answer was reached.
        temperature: 0,
        max_tokens: options.maxTokens ?? 800,
        ...(options.json ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      // The body can carry the model name and the rate-limit reason, both worth keeping. It cannot
      // carry the key, which was never in the body.
      const detail = await response.text().catch(() => '');
      throw new GroqError(response.status, `groq: ${response.status} ${detail.slice(0, 300)}`);
    }

    const payload = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };

    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.trim() === '') {
      throw new GroqError(502, 'groq returned an empty completion');
    }

    return content;
  } catch (error) {
    if (error instanceof GroqError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new GroqError(504, `groq did not answer within ${TIMEOUT_MS / 1000}s`);
    }
    throw new GroqError(502, `groq request failed: ${error instanceof Error ? error.message : 'unknown'}`);
  } finally {
    clearTimeout(timer);
  }
}
