/**
 * Golden baseline tests — doc 01 §3.4, and Day-3 audit finding F4.
 *
 * Two things are being proved here. First, that a baseline asserts what the spec says it may assert
 * and nothing more: identity exactly, everything else by presence, type and tolerance — because a
 * price that moved is the product working, not the scraper breaking. Second, that the whole module
 * is written against a SET of pinned URLs, so a collector growing from one URL to three is a data
 * change rather than a code change.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  captureBaseline,
  captureDetailBaseline,
  captureListingBaseline,
  compareBaseline,
  compareDetailBaseline,
  compareListingBaseline,
  evaluateGoldenSet,
  goldenFailures,
  LISTING_SAMPLE_SIZE,
} from '../dist/index.js';
import { CONTRACT, healthyRow, rows } from './fixtures.mjs';

const LISTING_CONTRACT = {
  ...CONTRACT,
  golden_set: ['https://master-weaver-theta.vercel.app/?layout=v1'],
  golden_set_shape: 'listing',
};

const URL_A = 'https://master-weaver-theta.vercel.app/p/1';

/** 12 distinct products, each repeated 12 times — the live shape. */
function duplicatedListing() {
  const out = [];
  for (let copy = 0; copy < 12; copy += 1) {
    for (let i = 1; i <= 12; i += 1) out.push(healthyRow(i));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------------------------

test('a listing baseline records DISTINCT rows, not the duplicated count', () => {
  const baseline = captureListingBaseline(duplicatedListing(), LISTING_CONTRACT);
  // 144 raw rows, but pinning 144 would make a later un-duplicated run fail its own regression test.
  assert.equal(baseline.row_count, 12);
});

test('a listing baseline pins a bounded sample by a stable key', () => {
  const baseline = captureListingBaseline(duplicatedListing(), LISTING_CONTRACT);
  assert.equal(baseline.sample_rows.length, LISTING_SAMPLE_SIZE);
  assert.equal(baseline.stable_key, 'product_name+product_url');
});

test('a listing baseline records the field shape without the request echo', () => {
  const baseline = captureListingBaseline(rows(3), LISTING_CONTRACT);
  assert.deepEqual(baseline.field_shape, ['in_stock', 'price', 'product_name', 'product_url']);
});

test('a detail baseline is one row', () => {
  const baseline = captureDetailBaseline(rows(1), CONTRACT);
  assert.equal(baseline.product_name, 'AeroBook Pro 1');
});

test('captureBaseline dispatches on the contract shape', () => {
  assert.equal(captureBaseline(rows(3), LISTING_CONTRACT).row_count, 3);
  assert.equal(captureBaseline(rows(3), CONTRACT).product_name, 'AeroBook Pro 1');
});

// ---------------------------------------------------------------------------------------------
// Detail comparison
// ---------------------------------------------------------------------------------------------

test('an unchanged detail page passes', () => {
  const baseline = captureDetailBaseline([healthyRow(1)], CONTRACT);
  const result = compareDetailBaseline([healthyRow(1)], baseline, CONTRACT, URL_A);
  assert.equal(result.passed, true);
  assert.deepEqual(result.failures, []);
});

test('a price that moved within tolerance still passes — that is the product working', () => {
  const baseline = captureDetailBaseline([healthyRow(1)], CONTRACT);
  const cheaper = { ...healthyRow(1), price: { value: 1000, currency: 'USD', symbol: '$' } };
  // 1300 -> 1000 is a 23% drop, inside this contract's 40% drift tolerance.
  const result = compareDetailBaseline([cheaper], baseline, CONTRACT, URL_A);
  assert.equal(result.passed, true);
});

test('a price outside tolerance fails, and says by how much', () => {
  const baseline = captureDetailBaseline([healthyRow(1)], CONTRACT);
  const collapsed = { ...healthyRow(1), price: { value: 12, currency: 'USD', symbol: '$' } };
  const result = compareDetailBaseline([collapsed], baseline, CONTRACT, URL_A);
  assert.equal(result.passed, false);
  assert.deepEqual(result.failures, ['price']);
  assert.match(result.checks.find((c) => c.aspect === 'price').reason, /from the baseline/);
});

test('a price that went empty fails as empty, not as a wrong type', () => {
  const baseline = captureDetailBaseline([healthyRow(1)], CONTRACT);
  const broken = { ...healthyRow(1), price: null };
  const result = compareDetailBaseline([broken], baseline, CONTRACT, URL_A);
  assert.match(result.checks.find((c) => c.aspect === 'price').reason, /is empty/);
});

test('identity fields are asserted exactly — a changed product name is a different product', () => {
  const baseline = captureDetailBaseline([healthyRow(1)], CONTRACT);
  const other = { ...healthyRow(1), product_name: 'Zenith Precision 16' };
  const result = compareDetailBaseline([other], baseline, CONTRACT, URL_A);
  assert.equal(result.passed, false);
  assert.deepEqual(result.failures, ['product_name']);
});

test('a run that returned nothing for a pinned URL fails, rather than passing vacuously', () => {
  const baseline = captureDetailBaseline([healthyRow(1)], CONTRACT);
  const result = compareDetailBaseline([], baseline, CONTRACT, URL_A);
  assert.equal(result.passed, false);
  assert.deepEqual(result.failures, ['rows']);
});

test('a URL with no captured baseline fails rather than passing unverified', () => {
  const result = compareDetailBaseline([healthyRow(1)], null, CONTRACT, URL_A);
  assert.equal(result.passed, false);
  assert.deepEqual(result.failures, ['baseline']);
});

// ---------------------------------------------------------------------------------------------
// Listing comparison
// ---------------------------------------------------------------------------------------------

test('an unchanged listing page passes', () => {
  const baseline = captureListingBaseline(duplicatedListing(), LISTING_CONTRACT);
  const result = compareListingBaseline(duplicatedListing(), baseline, LISTING_CONTRACT, URL_A);
  assert.equal(result.passed, true);
});

test('a listing that stopped duplicating still passes — de-duplication is applied to both sides', () => {
  const baseline = captureListingBaseline(duplicatedListing(), LISTING_CONTRACT);
  const clean = rows(12);
  const result = compareListingBaseline(clean, baseline, LISTING_CONTRACT, URL_A);
  assert.equal(result.passed, true);
});

test('a collapsed row count fails on row_count', () => {
  const baseline = captureListingBaseline(rows(12), LISTING_CONTRACT);
  const result = compareListingBaseline(rows(2), baseline, LISTING_CONTRACT, URL_A);
  assert.equal(result.passed, false);
  assert.ok(result.failures.includes('row_count'));
});

test('a field that vanished from every row fails on field_shape', () => {
  const baseline = captureListingBaseline(rows(12), LISTING_CONTRACT);
  const withoutPrice = rows(12).map(({ price, ...rest }) => rest);
  const result = compareListingBaseline(withoutPrice, baseline, LISTING_CONTRACT, URL_A);
  assert.equal(result.passed, false);
  assert.ok(result.failures.includes('field_shape'));
});

test('a page that GAINED a field is not a failure', () => {
  const baseline = captureListingBaseline(rows(12), LISTING_CONTRACT);
  const richer = rows(12).map((row) => ({ ...row, badge: 'New' }));
  assert.equal(compareListingBaseline(richer, baseline, LISTING_CONTRACT, URL_A).passed, true);
});

test('a pinned sample row that left the page is reported by its key', () => {
  const baseline = captureListingBaseline(rows(12), LISTING_CONTRACT);
  const missingFirst = rows(12).filter((row) => row.product_name !== baseline.sample_rows[0].product_name);
  const result = compareListingBaseline(missingFirst, baseline, LISTING_CONTRACT, URL_A);
  assert.equal(result.passed, false);
  assert.ok(result.failures.some((f) => f.startsWith('sample:')));
});

test('a reordered page still passes — samples are matched by key, not by position', () => {
  const baseline = captureListingBaseline(rows(12), LISTING_CONTRACT);
  const reversed = [...rows(12)].reverse();
  assert.equal(compareListingBaseline(reversed, baseline, LISTING_CONTRACT, URL_A).passed, true);
});

// ---------------------------------------------------------------------------------------------
// The set — N URLs, not one
// ---------------------------------------------------------------------------------------------

test('three pinned URLs, all passing, give a match rate of 1', () => {
  const entries = [1, 2, 3].map((i) => ({
    url: `https://master-weaver-theta.vercel.app/p/${i}`,
    baseline: captureDetailBaseline([healthyRow(i)], CONTRACT),
    rows: [healthyRow(i)],
  }));

  const result = evaluateGoldenSet(entries, CONTRACT);
  assert.equal(result.match_rate, 1);
  assert.equal(result.total_urls, 3);
  assert.equal(result.passed_urls, 3);
});

test('one failing URL out of three gives a match rate of 2/3', () => {
  const entries = [1, 2, 3].map((i) => ({
    url: `https://master-weaver-theta.vercel.app/p/${i}`,
    baseline: captureDetailBaseline([healthyRow(i)], CONTRACT),
    rows: i === 2 ? [{ ...healthyRow(2), price: null }] : [healthyRow(i)],
  }));

  const result = evaluateGoldenSet(entries, CONTRACT);
  assert.ok(Math.abs(result.match_rate - 2 / 3) < 1e-6);
  assert.equal(result.passed_urls, 2);
});

test('a single-URL listing collector is the degenerate case of the same function', () => {
  const baseline = captureListingBaseline(duplicatedListing(), LISTING_CONTRACT);
  const result = evaluateGoldenSet(
    [{ url: LISTING_CONTRACT.golden_set[0], baseline, rows: duplicatedListing() }],
    LISTING_CONTRACT,
  );
  assert.equal(result.match_rate, 1);
  assert.equal(result.total_urls, 1);
});

test('a URL that returned nothing still counts in the denominator', () => {
  const entries = [
    { url: URL_A, baseline: captureDetailBaseline([healthyRow(1)], CONTRACT), rows: [healthyRow(1)] },
    { url: 'https://master-weaver-theta.vercel.app/p/2', baseline: null, rows: null },
  ];
  const result = evaluateGoldenSet(entries, CONTRACT);
  assert.equal(result.total_urls, 2);
  assert.equal(result.match_rate, 0.5);
});

test('an empty pinned set does not penalise a collector that has no baseline yet', () => {
  const result = evaluateGoldenSet([], CONTRACT);
  assert.equal(result.match_rate, 1);
  assert.equal(result.total_urls, 0);
});

test('goldenFailures collects every failed aspect across the set, without repeats', () => {
  const entries = [1, 2].map((i) => ({
    url: `https://master-weaver-theta.vercel.app/p/${i}`,
    baseline: captureDetailBaseline([healthyRow(i)], CONTRACT),
    rows: [{ ...healthyRow(i), price: null }],
  }));

  assert.deepEqual(goldenFailures(evaluateGoldenSet(entries, CONTRACT)), ['price']);
});

test('compareBaseline dispatches on shape and accepts an explicit override', () => {
  const listingBaseline = captureListingBaseline(rows(12), LISTING_CONTRACT);
  assert.equal(compareBaseline(rows(12), listingBaseline, LISTING_CONTRACT, URL_A).passed, true);

  const detailBaseline = captureDetailBaseline([healthyRow(1)], CONTRACT);
  assert.equal(compareBaseline([healthyRow(1)], detailBaseline, CONTRACT, URL_A, 'detail').passed, true);
});

test('the match rate feeds golden_penalty as a plain 0..1 number', () => {
  const result = evaluateGoldenSet([], CONTRACT);
  assert.ok(result.match_rate >= 0 && result.match_rate <= 1);
});
