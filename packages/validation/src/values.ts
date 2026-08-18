/**
 * Getting a comparable value out of a scraped row — the `fill_rate` half of the Field Health Score.
 *
 * A contract declares `{ name: "price", type: "number" }`. The CLI returns
 * `price: { value: 1299, currency: "USD", symbol: "$" }`. Reading `row.price` and asking "is this a
 * number?" answers "no" on a completely healthy run, so the scorer would report FHS 0 for a
 * collector that is working perfectly. Every field has to be unwrapped to its carrying scalar before
 * it is measured — see {@link unwrapScalar}, which is the whole reason this module exists.
 */

import type { FieldContract, FieldType } from '@weaver/contracts';

/**
 * Strings that mean "nothing", so `fill_rate` counts them as unfilled.
 *
 * A collector that has stopped finding a field does not always return `null` — it returns the string
 * `"null"`, or `"N/A"`, or an em dash where the template had a fallback. Doc 01 §3.3: the failure
 * mode that actually happens is a field going quietly empty, and these are how "empty" arrives.
 *
 * Kept deliberately short. Every token added here is a real value some site could legitimately
 * publish, so the list only holds spellings no scraper would emit as genuine content.
 */
export const NULLISH_TOKENS: ReadonlySet<string> = new Set([
  'null',
  'undefined',
  'nan',
  'n/a',
  'none',
  '-',
  '--',
  '–',
  '—',
]);

/**
 * Keys that carry the scalar inside a wrapper object, per declared type.
 *
 * `value` first for numbers is the Bright Data money envelope. The rest are the shapes the same
 * collector emits for links and rich text.
 */
const WRAPPER_KEYS: Record<FieldType, readonly string[]> = {
  number: ['value', 'amount', 'raw'],
  text: ['value', 'text', 'raw'],
  boolean: ['value', 'raw'],
  url: ['url', 'href', 'value', 'raw'],
};

/** Depth limit for {@link unwrapScalar}. Guards against a self-referential row. */
const MAX_UNWRAP_DEPTH = 4;

/** Distinguishes "no carrying key found" from "carrying key held `undefined`". */
const NO_KEY = Symbol('no-carrying-key');

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reduce a wrapped value to the scalar the contract is actually about.
 *
 * Objects unwrap through the type's {@link WRAPPER_KEYS}, or through their sole key when they have
 * exactly one. Single-element arrays unwrap to their element.
 *
 * Two non-unwrappings are load-bearing, because each is a real break the scorer must catch:
 *
 * - An object with **no** carrying key is returned as-is. `{ currency: "USD", symbol: "$" }` — the
 *   price envelope with the price gone — stays an object, counts as present, and fails the number
 *   check. Score 0, reported as a type failure.
 * - A **multi-element** array is returned as-is. A scalar field answering with five values means the
 *   selector widened and matched the whole list, so it fails rather than silently taking the first.
 *
 * `{ value: null }` unwraps to `null`, which is the case worth reading twice: the envelope arrived
 * but the price inside it did not, so this is scored as an empty field rather than a wrong type.
 * That is the honest reading, and it is the one that shows up correctly in the ledger's fill rate.
 */
export function unwrapScalar(value: unknown, type: FieldType): unknown {
  let current = value;

  for (let depth = 0; depth < MAX_UNWRAP_DEPTH; depth += 1) {
    if (Array.isArray(current)) {
      if (current.length !== 1) return current;
      current = current[0];
      continue;
    }

    if (!isPlainObject(current)) return current;

    const keys = Object.keys(current);
    if (keys.length === 0) return current;

    let next: unknown = NO_KEY;
    for (const key of WRAPPER_KEYS[type]) {
      if (key in current) {
        next = current[key];
        break;
      }
    }
    if (next === NO_KEY && keys.length === 1) next = current[keys[0] as string];
    if (next === NO_KEY) return current;

    if (isPlainObject(next) || Array.isArray(next)) {
      current = next;
      continue;
    }
    return next;
  }

  return current;
}

/**
 * Read a field off a row by name, falling back to a dotted path.
 *
 * The literal key wins, so a collector that really does emit a key called `"input.url"` is read
 * correctly rather than walked into. Anything that is not an object — a `null` row, a stray string
 * in the array — reads as `undefined` rather than throwing.
 */
export function readPath(row: unknown, name: string): unknown {
  if (!isPlainObject(row)) return undefined;
  if (name in row) return row[name];
  if (!name.includes('.')) return undefined;

  let current: unknown = row;
  for (const segment of name.split('.')) {
    if (!isPlainObject(current) || !(segment in current)) return undefined;
    current = current[segment];
  }
  return current;
}

/**
 * Whether a value counts toward `fill_rate`.
 *
 * `false` and `0` are filled. They are the two values a naive truthiness check drops, and dropping
 * them would mean an out-of-stock product or a free item read as a scraping failure.
 */
export function isFilled(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed !== '' && !NULLISH_TOKENS.has(trimmed.toLowerCase());
  }
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

/** Read a contract field out of a row and unwrap it, ready for {@link isFilled} and coercion. */
export function extractFieldValue(row: unknown, field: FieldContract): unknown {
  return unwrapScalar(readPath(row, field.name), field.type);
}
