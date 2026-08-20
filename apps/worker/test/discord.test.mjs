/**
 * Discord alert tests — doc 03 §6.3.
 *
 * Two properties matter more than the embed formatting.
 *
 * **Restraint.** Exactly three events fire. The test that asserts a transient failure sends nothing
 * is guarding a design decision, not an implementation detail: doc 03 calls alert fatigue "a design
 * flaw a judge will notice", and the surest way to earn it is to notify on every state change.
 *
 * **Delivery is never load-bearing.** A webhook that 500s, times out, or was never configured must
 * not fail an episode. The repair either happened or it did not; Discord's opinion is not part of
 * the transaction.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createNotifier, silentNotifier } from '../dist/discord.js';
import { testLog } from './helpers.mjs';

const WEBHOOK = 'https://discord.com/api/webhooks/test/token';
const APP = 'https://master-weaver.vercel.app';

/** Captures posts instead of sending them. */
function capture({ ok = true, status = 204, throws = false } = {}) {
  const posts = [];
  const fetchImpl = async (url, init) => {
    posts.push({ url, body: JSON.parse(init.body), init });
    if (throws) throw new Error('network is down');
    return { ok, status };
  };
  return { posts, fetchImpl };
}

function notifier(overrides = {}) {
  const cap = capture(overrides.capture);
  return {
    cap,
    notify: createNotifier(
      { webhookUrl: WEBHOOK, appBaseUrl: APP, fetchImpl: cap.fetchImpl, ...overrides.config },
      testLog,
    ),
  };
}

const RESTORED = {
  collectorName: 'marketplace-listings',
  fieldsRepaired: ['price'],
  fhsBefore: 0.05,
  fhsAfter: 0.97,
  attempts: 2,
  rejections: 1,
  creditsSpent: 34,
  durationMs: 41_000,
};

const QUARANTINED = {
  collectorName: 'marketplace-listings',
  reason: 'circuit breaker tripped — this collector has already been healed 3 times in 24 hours',
  attempts: 0,
  fhsBefore: 0.05,
  creditsSpent: 0,
  durationMs: 1200,
};

const PENDING = {
  collectorId: '6985268d-0a3e-4602-8015-ad82f4354db3',
  collectorName: 'marketplace-listings',
  fhsBefore: 0.95,
  fhsNow: 0.8,
  failedFields: ['price'],
  healthyFields: ['product_name', 'ram', 'storage', 'in_stock'],
  proposedFix: 'The scraper stopped extracting 1 field(s) after a site layout change.',
};

// ---------------------------------------------------------------------------------------------
// The three events
// ---------------------------------------------------------------------------------------------

test('RESTORED reports what was repaired and what it cost', async () => {
  const { cap, notify } = notifier();
  await notify.restored(RESTORED);

  assert.equal(cap.posts.length, 1);
  const embed = cap.posts[0].body.embeds[0];

  assert.match(embed.title, /Pipeline restored/);
  assert.match(embed.title, /marketplace-listings/);
  assert.equal(embed.color, 5_763_719);

  const byName = Object.fromEntries(embed.fields.map((f) => [f.name, f.value]));
  assert.equal(byName['Fields repaired'], 'price');
  assert.equal(byName.Health, '0.05 → 0.97');
  assert.equal(byName.Attempts, '2 (1 rejected)');
  assert.equal(byName.Cost, '34 credits · 41s');
});

test('a first-try repair does not claim rejections it did not have', async () => {
  const { cap, notify } = notifier();
  await notify.restored({ ...RESTORED, attempts: 1, rejections: 0 });

  const byName = Object.fromEntries(cap.posts[0].body.embeds[0].fields.map((f) => [f.name, f.value]));
  assert.equal(byName.Attempts, '1');
});

test('QUARANTINED carries the reason it stopped, in red rather than amber', async () => {
  const { cap, notify } = notifier();
  await notify.quarantined(QUARANTINED);

  const embed = cap.posts[0].body.embeds[0];
  assert.match(embed.title, /Needs your review/);
  assert.match(embed.description, /healed 3 times in 24 hours/);
  // Amber is reserved for the healing state and the low-credit warning (doc 05 §2.2). An error in
  // amber makes the healing badge stop reading as an event.
  assert.equal(embed.color, 13_646_651);
  assert.notEqual(embed.color, 16_436_245);
});

test('PENDING_OPERATOR is decidable without opening the app, and links to it anyway', async () => {
  const { cap, notify } = notifier();
  await notify.pendingOperator(PENDING);

  const embed = cap.posts[0].body.embeds[0];
  assert.match(embed.title, /repair needs your approval/);
  assert.equal(embed.color, 16_436_245);
  assert.equal(embed.url, `${APP}/c/${PENDING.collectorId}?action=repair`);

  const byName = Object.fromEntries(embed.fields.map((f) => [f.name, f.value]));
  assert.equal(byName.Health, '0.95 → 0.80');
  assert.equal(byName['Fields failing'], 'price');
  assert.equal(byName['Still healthy'], 'product_name, ram, storage, in_stock');
  assert.match(byName['Proposed fix'], /stopped extracting/);
});

test('the deep link survives a base URL with a trailing slash', async () => {
  const { cap, notify } = notifier({ config: { appBaseUrl: `${APP}/` } });
  await notify.pendingOperator(PENDING);
  assert.equal(cap.posts[0].body.embeds[0].url, `${APP}/c/${PENDING.collectorId}?action=repair`);
});

// ---------------------------------------------------------------------------------------------
// Restraint
// ---------------------------------------------------------------------------------------------

test('the notifier exposes exactly three events and nothing else', () => {
  const { notify } = notifier();
  const events = Object.keys(notify).filter((k) => typeof notify[k] === 'function');
  assert.deepEqual(events.sort(), ['pendingOperator', 'quarantined', 'restored']);
});

test('no webhook configured sends nothing and reports itself disabled', async () => {
  const cap = capture();
  const notify = createNotifier(
    { webhookUrl: null, appBaseUrl: APP, fetchImpl: cap.fetchImpl },
    testLog,
  );

  assert.equal(notify.enabled, false);
  await notify.restored(RESTORED);
  await notify.quarantined(QUARANTINED);
  await notify.pendingOperator(PENDING);
  assert.equal(cap.posts.length, 0);
});

test('silentNotifier is a drop-in that does nothing', async () => {
  assert.equal(silentNotifier.enabled, false);
  await silentNotifier.restored(RESTORED);
  await silentNotifier.quarantined(QUARANTINED);
  await silentNotifier.pendingOperator(PENDING);
});

// ---------------------------------------------------------------------------------------------
// Delivery is never load-bearing
// ---------------------------------------------------------------------------------------------

test('a webhook that rejects the post does not throw', async () => {
  const { notify } = notifier({ capture: { ok: false, status: 429 } });
  await notify.restored(RESTORED); // must resolve
});

test('a network failure does not throw', async () => {
  const { notify } = notifier({ capture: { throws: true } });
  await notify.quarantined(QUARANTINED); // must resolve
});

test('an unmeasured cost says so rather than reporting zero', async () => {
  const { cap, notify } = notifier();
  await notify.restored({ ...RESTORED, creditsSpent: null });

  const byName = Object.fromEntries(cap.posts[0].body.embeds[0].fields.map((f) => [f.name, f.value]));
  assert.match(byName.Cost, /unmeasured/);
});

test('empty field lists render as an em dash, never as a blank', async () => {
  const { cap, notify } = notifier();
  await notify.pendingOperator({ ...PENDING, failedFields: [], healthyFields: [] });

  const byName = Object.fromEntries(cap.posts[0].body.embeds[0].fields.map((f) => [f.name, f.value]));
  assert.equal(byName['Fields failing'], '—');
  assert.equal(byName['Still healthy'], '—');
});

test('a long proposed fix is clamped to the documented 300 characters', async () => {
  const { cap, notify } = notifier();
  await notify.pendingOperator({ ...PENDING, proposedFix: 'x'.repeat(5000) });

  const byName = Object.fromEntries(cap.posts[0].body.embeds[0].fields.map((f) => [f.name, f.value]));
  assert.ok(byName['Proposed fix'].length <= 300);
  assert.ok(byName['Proposed fix'].endsWith('…'));
});

test('every alert carries a timestamp', async () => {
  const { cap, notify } = notifier();
  await notify.restored(RESTORED);
  assert.ok(!Number.isNaN(Date.parse(cap.posts[0].body.embeds[0].timestamp)));
});
