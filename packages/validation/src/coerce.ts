/**
 * Type coercion — the `type_pass` half of the Field Health Score.
 *
 * Every parser here returns the coerced value on success and `null` on failure, so a caller can
 * write `parseNumber(v) !== null` for a pass/fail check and still get the value when it needs one.
 *
 * The bar these set is deliberate. `type_pass` exists to catch a redesign that starts returning the
 * shipping cost, the currency code, or a fragment of markup where a price used to be — so parsing is
 * *strict about the tail of the string*. `parseFloat("1299abc") === 1299` is exactly the sloppiness
 * that would let a broken run score healthy, so nothing here uses it: a string is normalised, then
 * matched whole against a numeric pattern, and anything left over is a failure.
 *
 * It is not, however, strict about presentation. Real collector output for one field drifts between
 * `1299`, `"1299"`, `"$1,299.00"` and `"1299 USD"` from run to run without anything being broken, so
 * all four parse. See {@link normalizeNumericString} for the separator rules.
 */

/** Currency glyphs a scraper leaves attached to a price. */
const CURRENCY_SYMBOLS = /[$€£¥₹₩₽¢₪₺₴₦﷼]/g;

/** ISO 4217 codes common enough to appear beside a scraped price. */
const ISO_CURRENCY_CODES =
  /\b(?:USD|EUR|GBP|JPY|INR|CAD|AUD|CHF|CNY|SEK|NZD|MXN|BRL|ZAR|KRW|RUB|PLN|TRY|AED|SGD|HKD)\b/gi;

/** Any whitespace, including the non-breaking and thin spaces used as digit-group separators. */
const ANY_WHITESPACE = /\s/g;

/** What a normalised number must look like before {@link Number} is allowed near it. */
const STRICT_NUMERIC = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;

/** `1,299` / `1,234,567` — comma as a digit-group separator. */
const COMMA_GROUPED = /^[+-]?\d{1,3}(?:,\d{3})+$/;

/** `1299,00` / `1299,5` — comma as a decimal separator, the European convention. */
const COMMA_DECIMAL = /^[+-]?\d+,\d{1,2}$/;

/** Schemes a `url` field may carry. A `data:` or `javascript:` URL in a product link is a break. */
const ALLOWED_URL_PROTOCOLS = new Set(['http:', 'https:']);

/** Anything that starts with `<scheme>:`. Used to reject non-http schemes before relative parsing. */
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** String spellings of `true`, lowercased and whitespace-collapsed. */
const TRUE_TOKENS = new Set([
  'true',
  't',
  'yes',
  'y',
  '1',
  'in stock',
  'instock',
  'in-stock',
  'in_stock',
  'available',
  'on',
  'enabled',
]);

/** String spellings of `false`, lowercased and whitespace-collapsed. */
const FALSE_TOKENS = new Set([
  'false',
  'f',
  'no',
  'n',
  '0',
  'out of stock',
  'outofstock',
  'out-of-stock',
  'out_of_stock',
  'sold out',
  'soldout',
  'unavailable',
  'off',
  'disabled',
]);

/**
 * Strip currency decoration and normalise digit-group and decimal separators to the `1234.56` form.
 *
 * Returns `null` when nothing numeric-looking survives. The one genuinely ambiguous case is a single
 * comma, resolved by the length of its tail — `1,299` has three trailing digits so the comma is a
 * group separator (1299), `1,29` has two so it is a decimal point (1.29). That is the convention
 * every locale agrees on in practice, and it is the reading that keeps `"$1,299.00"` scoring as the
 * price it is.
 */
export function normalizeNumericString(input: string): string | null {
  let s = input.trim();
  if (s === '') return null;

  s = s.replace(ISO_CURRENCY_CODES, '').replace(CURRENCY_SYMBOLS, '').replace(ANY_WHITESPACE, '');
  if (s === '') return null;

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');

  if (lastComma !== -1 && lastDot !== -1) {
    // Both present: whichever comes last is the decimal separator.
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(/,/g, '.') : s.replace(/,/g, '');
  } else if (lastComma !== -1) {
    if (COMMA_GROUPED.test(s)) s = s.replace(/,/g, '');
    else if (COMMA_DECIMAL.test(s)) s = s.replace(',', '.');
    else s = s.replace(/,/g, '');
  }

  return s;
}

/**
 * Parse a `number` field value.
 *
 * Booleans do not count — `true` is not 1 here. A number-typed field returning a boolean means the
 * extractor picked up the wrong node, which is precisely what this is meant to catch.
 */
export function parseNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;

  const normalized = normalizeNumericString(value);
  if (normalized === null || !STRICT_NUMERIC.test(normalized)) return null;

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Parse a `boolean` field value.
 *
 * The token lists cover the spellings that actually reach us: the Chaos Lab and every retail site
 * like it render availability as `"In Stock"` / `"Out of Stock"` rather than as a JSON boolean, so a
 * `boolean` contract on `in_stock` has to read those or it would score 0 on a perfectly healthy run.
 * Numbers coerce only from exactly 0 or 1 — `2` is not a boolean, it is a wrong node.
 */
export function parseBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
    return null;
  }
  if (typeof value !== 'string') return null;

  const token = value.trim().toLowerCase().replace(/\s+/g, ' ');
  if (TRUE_TOKENS.has(token)) return true;
  if (FALSE_TOKENS.has(token)) return false;
  return null;
}

/**
 * Parse a `text` field value, returning the trimmed string.
 *
 * Numbers and booleans pass and stringify: one field's output drifts between `16` and `"16 GB"`
 * across runs without anything being wrong, and failing a run for that would be a false alarm.
 * Objects and arrays do not pass — by the time a value reaches here it has already been unwrapped
 * (see `extractFieldValue`), so a surviving container means the shape genuinely is not text.
 */
export function parseText(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
  if (typeof value === 'boolean') return String(value);
  return null;
}

/** Non-throwing {@link URL} construction. */
function tryUrl(input: string, base?: string): URL | null {
  try {
    return new URL(input, base);
  } catch {
    return null;
  }
}

/**
 * Parse a `url` field value.
 *
 * Two modes, chosen by the field contract's `absolute` flag (doc 01 §3.1):
 *
 * - `absolute: true`  — must parse as a full `http(s)` URL with a host. This is the setting for a
 *   `product_url` you intend to re-crawl, and it is what catches a redesign that starts emitting
 *   `/p/123` where a canonical link used to be.
 * - otherwise — a site-relative reference also passes, provided it contains a `/` and no whitespace.
 *   The `/` requirement is what stops `"1299"` or `"Out of Stock"` from counting as a URL; without
 *   it nearly any string is a technically valid relative reference and the check would be worthless.
 *
 * Either way the scheme must be `http` or `https`. `data:` and `javascript:` are failures, not URLs.
 */
export function parseUrl(value: unknown, options: { absolute?: boolean } = {}): string | null {
  if (typeof value !== 'string') return null;

  const raw = value.trim();
  if (raw === '' || /\s/.test(raw)) return null;

  const absolute = tryUrl(raw);
  if (absolute !== null) {
    return ALLOWED_URL_PROTOCOLS.has(absolute.protocol) && absolute.host !== '' ? raw : null;
  }
  if (options.absolute === true) return null;

  // Protocol-relative (`//cdn.example.com/a.jpg`) — resolvable, just missing its scheme.
  if (raw.startsWith('//')) return tryUrl(`https:${raw}`) === null ? null : raw;

  // A scheme that failed to parse above is a malformed absolute URL, not a relative one.
  if (HAS_SCHEME.test(raw)) return null;
  if (!raw.includes('/')) return null;

  return tryUrl(raw, 'https://relative.invalid/') === null ? null : raw;
}
