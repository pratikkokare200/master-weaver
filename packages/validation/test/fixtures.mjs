/**
 * Shared test fixtures.
 *
 * `CONTRACT` is the contract from doc 01 §3.1 verbatim, and `contracts.test.mjs` parses it through
 * the real `CollectorContractSchema` so it cannot drift into a shape the system would never hold.
 * The rows mirror `docs/samples/run_v1.json`: nested `price` envelope, `"In Stock"` string rather
 * than a JSON boolean, and the `input: { url }` echo every row carries.
 */

/** The doc 01 §3.1 contract. Weights: 2 + 2 + 1 + 2 = 7. */
export const CONTRACT = {
  collector_id: 'c_mpohus372o5tmid1jk',
  fields: [
    { name: 'product_name', type: 'text', required: true, min_fill: 0.95 },
    {
      name: 'price',
      type: 'number',
      required: true,
      min_fill: 0.9,
      range: [1, 100000],
      drift_tolerance: 0.4,
    },
    { name: 'in_stock', type: 'boolean', required: false, min_fill: 0.5 },
    { name: 'product_url', type: 'url', required: true, min_fill: 0.95, absolute: true },
  ],
  row_count: { min: 5, drift_tolerance: 0.5 },
  golden_set: [
    'https://master-weaver-theta.vercel.app/p/1',
    'https://master-weaver-theta.vercel.app/p/2',
    'https://master-weaver-theta.vercel.app/p/3',
  ],
  golden_set_shape: 'detail',
};

/** Total contract weight, kept here so the hand-computed FHS in the tests stays checkable. */
export const TOTAL_WEIGHT = 7;

/** One healthy row, shaped exactly like real CLI output. */
export function healthyRow(index = 1) {
  return {
    product_name: `AeroBook Pro ${index}`,
    price: { value: 1299 + index, currency: 'USD', symbol: '$' },
    in_stock: 'In Stock',
    product_url: `https://master-weaver-theta.vercel.app/p/${index}`,
    input: { url: 'https://master-weaver-theta.vercel.app/' },
  };
}

/** `count` healthy rows, optionally mutated by `patch(row, index)` to introduce a break. */
export function rows(count, patch) {
  return Array.from({ length: count }, (_, i) => {
    const row = healthyRow(i + 1);
    return patch ? patch(row, i) : row;
  });
}

/** Freeze a value and everything under it, so a purity test can prove nothing is written back. */
export function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value)) deepFreeze(value[key]);
  return value;
}
