/**
 * @weaver/textsql — the guard, the schema description, and the prompt.
 *
 * Pure and synchronous. No HTTP client and no database driver: the Groq call and the query live in
 * the route handler, so everything that decides whether a statement may run can be tested without a
 * network or a model.
 *
 * The security story is two layers, and this package is only the first:
 *
 *   1. `assertReadOnlySql` — a string check on model output, which is the weaker layer by nature.
 *   2. `supabase/migrations/0003_readonly_role.sql` — a role with SELECT and nothing else, in a
 *      transaction Postgres has marked read-only. This one holds when the first fails.
 */

export { assertReadOnlySql, UnsafeSqlError, MAX_SQL_CHARS, DEFAULT_ROW_LIMIT } from './guard.js';
export type { SafeSql } from './guard.js';

export { lex } from './lex.js';
export type { Lexed } from './lex.js';

export { SCHEMA, schemaPrompt } from './schema.js';
export type { ColumnDoc, TableDoc } from './schema.js';

export { systemPrompt, parseAnswer } from './prompt.js';
export type { PromptOptions, ParsedAnswer, CollectorField } from './prompt.js';
