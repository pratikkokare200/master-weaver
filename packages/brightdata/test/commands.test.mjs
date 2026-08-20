/**
 * Command-surface tests.
 *
 * The `--auto-approve` assertions here are the executable form of the hard rule. If someone adds
 * the flag to the heal wrapper "to make it simpler", these fail.
 *
 * End-to-end cases run against a fake CLI shim — a real `.cmd` on Windows, mirroring the
 * `brightdata.cmd` shim that forces `shell: true` in the first place — so argv construction, shell
 * quoting, binary resolution, stream separation and JSON parsing are all exercised together
 * without spending a credit.
 */

import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  BrightDataCliError,
  approveHeal,
  assertNoForbiddenFlags,
  createScraper,
  getBudget,
  healScraper,
  probeUrl,
  rejectHeal,
  runScraper,
} from '../dist/index.js';

const API_KEY = 'bd_test_key_0123456789';
const ENV = { ...process.env, BRIGHTDATA_API_KEY: API_KEY };
const COLLECTOR = 'c_mswyapbp22wiwv8fhh';
const TARGET = 'https://master-weaver-theta.vercel.app/?layout=v2';

const dir = mkdtempSync(join(tmpdir(), 'weaver-cli-'));

/** A stand-in for `brightdata` that echoes its argv as JSON and writes a line to stderr. */
function makeFakeCli() {
  const script = join(dir, 'fake-cli.mjs');
  writeFileSync(
    script,
    [
      "process.stderr.write('fake-cli: diagnostic on stderr\\n');",
      'console.log(JSON.stringify({ argv: process.argv.slice(2) }));',
      '',
    ].join('\n'),
  );

  if (process.platform === 'win32') {
    const cmd = join(dir, 'fake-cli.cmd');
    writeFileSync(cmd, ['@echo off', 'node "%~dp0fake-cli.mjs" %*', ''].join('\r\n'));
    return cmd;
  }

  const sh = join(dir, 'fake-cli.sh');
  writeFileSync(sh, ['#!/bin/sh', 'exec node "$(dirname "$0")/fake-cli.mjs" "$@"', ''].join('\n'));
  chmodSync(sh, 0o755);
  return sh;
}

const FAKE_CLI = makeFakeCli();
const opts = { bin: FAKE_CLI, env: ENV };

/** Capture the argv a wrapper builds, without needing the call to succeed. */
async function capture(invoke) {
  const lines = [];
  await invoke({ ...opts, logger: (event) => event.phase === 'start' && lines.push(event.argvRedacted) });
  assert.equal(lines.length, 1, 'expected exactly one start event');
  return lines[0];
}

// ---------------------------------------------------------------------------------------------
// The hard rule
// ---------------------------------------------------------------------------------------------

test('heal NEVER passes --auto-approve', async () => {
  const line = await capture((o) =>
    healScraper({ collectorId: COLLECTOR, diagnosis: 'price stopped extracting', url: TARGET }, o),
  );
  assert.ok(!line.includes('--auto-approve'), `--auto-approve leaked into: ${line}`);
  assert.ok(!line.includes('--auto-save'), `--auto-save leaked into: ${line}`);
});

test('no wrapper anywhere passes --auto-approve', async () => {
  const lines = await Promise.all([
    capture((o) => createScraper({ url: TARGET, description: 'Extract product name, price' }, o)),
    capture((o) => runScraper({ collectorId: COLLECTOR, url: TARGET }, o)),
    capture((o) => healScraper({ collectorId: COLLECTOR, diagnosis: 'broken', url: TARGET }, o)),
    capture((o) => approveHeal({ collectorId: COLLECTOR, url: TARGET }, o)),
    capture((o) => rejectHeal({ collectorId: COLLECTOR }, o)),
    capture((o) => probeUrl({ url: TARGET }, o)),
    capture((o) => getBudget({}, o)),
  ]);
  for (const line of lines) {
    assert.ok(!line.includes('--auto-approve'), `--auto-approve in: ${line}`);
  }
});

test('--auto-save appears on approve and on nothing else', async () => {
  const others = await Promise.all([
    capture((o) => createScraper({ url: TARGET, description: 'Extract product name, price' }, o)),
    capture((o) => runScraper({ collectorId: COLLECTOR, url: TARGET }, o)),
    capture((o) => healScraper({ collectorId: COLLECTOR, diagnosis: 'broken', url: TARGET }, o)),
    capture((o) => rejectHeal({ collectorId: COLLECTOR }, o)),
    capture((o) => probeUrl({ url: TARGET }, o)),
    capture((o) => getBudget({}, o)),
  ]);
  for (const line of others) {
    assert.ok(!line.includes('--auto-save'), `--auto-save in: ${line}`);
  }

  // Approve is the exception, and it is not optional: without the flag the CLI reports the heal
  // approved while the collector keeps serving the old template, so the fix silently does not land.
  const approve = await capture((o) => approveHeal({ collectorId: COLLECTOR, url: TARGET }, o));
  assert.ok(approve.includes('--auto-save'), `approve must commit the template: ${approve}`);
});

test('the spawn boundary rejects a hand-rolled --auto-approve argv', () => {
  assert.throws(
    () => assertNoForbiddenFlags(['scraper', 'heal', COLLECTOR, 'x', '--auto-approve', '--json']),
    (error) => error instanceof BrightDataCliError && error.kind === 'forbidden_flag',
  );
  // Not even on approve, where --auto-save is allowed. The pair is what skips the gate.
  assert.throws(
    () => assertNoForbiddenFlags(['scraper', 'approve', COLLECTOR, '--auto-approve']),
    (error) => error instanceof BrightDataCliError && error.kind === 'forbidden_flag',
  );
  // A benign argv passes through untouched.
  assert.doesNotThrow(() => assertNoForbiddenFlags(['scraper', 'run', COLLECTOR, '--json']));
});

test('the spawn boundary allows --auto-save ONLY on approve', () => {
  assert.doesNotThrow(() =>
    assertNoForbiddenFlags(['scraper', 'approve', COLLECTOR, '--auto-save', '--json']),
  );

  // On heal it commits the template as part of the heal itself, which skips the review entirely.
  for (const argv of [
    ['scraper', 'heal', COLLECTOR, 'price broke', '--auto-save'],
    ['scraper', 'create', '--auto-save'],
    ['scraper', 'run', COLLECTOR, '--auto-save'],
  ]) {
    assert.throws(
      () => assertNoForbiddenFlags(argv),
      (error) => error instanceof BrightDataCliError && error.kind === 'forbidden_flag',
      `${argv[1]} must not accept --auto-save`,
    );
  }
});

// ---------------------------------------------------------------------------------------------
// argv construction
// ---------------------------------------------------------------------------------------------

test('every command passes --json', async () => {
  const lines = await Promise.all([
    capture((o) => createScraper({ url: TARGET, description: 'Extract name' }, o)),
    capture((o) => runScraper({ collectorId: COLLECTOR, url: TARGET }, o)),
    capture((o) => healScraper({ collectorId: COLLECTOR, diagnosis: 'broken' }, o)),
    capture((o) => approveHeal({ collectorId: COLLECTOR }, o)),
    capture((o) => rejectHeal({ collectorId: COLLECTOR }, o)),
    capture((o) => probeUrl({ url: TARGET }, o)),
    capture((o) => getBudget({}, o)),
  ]);
  for (const line of lines) assert.ok(line.includes('--json'), `missing --json: ${line}`);
});

test('reject uses approve --reject, the primary rollback', async () => {
  const line = await capture((o) => rejectHeal({ collectorId: COLLECTOR }, o));
  assert.match(line, /scraper approve .*--reject/);
});

test('a golden-set confirmation run batches URLs into --urls', async () => {
  const urls = ['https://x.dev/p/1', 'https://x.dev/p/2', 'https://x.dev/p/3'];
  const line = await capture((o) => runScraper({ collectorId: COLLECTOR, urls }, o));
  assert.ok(line.includes(`--urls ${urls.join(',')}`), line);
});

test('the API key never appears in a logged command line', async () => {
  const line = await capture((o) => runScraper({ collectorId: COLLECTOR, url: TARGET }, o));
  assert.ok(!line.includes(API_KEY), 'API key leaked into the logged argv');
});

// ---------------------------------------------------------------------------------------------
// End-to-end through the fake shim
// ---------------------------------------------------------------------------------------------

test('heal survives the shell with its diagnosis and URL intact', async () => {
  const diagnosis =
    'The layout changed from a table to a card grid. Fields "price" & "product_name" stopped ' +
    'extracting (fill rate 0.12, was 1.00).';
  const result = await healScraper({ collectorId: COLLECTOR, diagnosis, url: TARGET }, opts);

  assert.equal(result.ok, true, result.error?.message);
  const argv = result.data.argv;
  assert.deepEqual(argv.slice(0, 4), ['scraper', 'heal', COLLECTOR, diagnosis]);
  assert.ok(argv.includes('--json'));
  assert.ok(!argv.includes('--auto-approve'));
  // The URL kept its query string — the `&`-truncation regression.
  assert.equal(argv[argv.indexOf('--url') + 1], TARGET);
});

test('stdout and stderr are captured separately', async () => {
  const result = await runScraper({ collectorId: COLLECTOR, url: TARGET }, opts);
  assert.equal(result.ok, true, result.error?.message);
  assert.match(result.stderr, /diagnostic on stderr/);
  assert.ok(!result.stdout.includes('diagnostic on stderr'), 'stderr bled into stdout');
  assert.ok(result.stderrExcerpt.length > 0);
});

test('a result carries a redacted, persistable command line', async () => {
  const result = await probeUrl({ url: TARGET }, opts);
  assert.equal(result.ok, true, result.error?.message);
  assert.ok(!result.argvRedacted.includes(API_KEY));
  assert.ok(result.argvRedacted.includes('scrape'));
  assert.ok(typeof result.durationMs === 'number');
});

// ---------------------------------------------------------------------------------------------
// Caller-side validation
// ---------------------------------------------------------------------------------------------

test('a diagnosis over the CLI limit is rejected rather than silently truncated', async () => {
  await assert.rejects(
    () => healScraper({ collectorId: COLLECTOR, diagnosis: 'x'.repeat(1001) }, opts),
    (error) => error instanceof BrightDataCliError && error.kind === 'validation',
  );
});

test('an intent over the CLI limit is rejected', async () => {
  await assert.rejects(
    () => createScraper({ url: TARGET, description: 'x'.repeat(501) }, opts),
    (error) => error instanceof BrightDataCliError && error.kind === 'validation',
  );
});

test('a missing API key fails fast instead of hanging on an interactive login', async () => {
  const bare = { ...process.env };
  delete bare.BRIGHTDATA_API_KEY;
  await assert.rejects(
    () => runScraper({ collectorId: COLLECTOR, url: TARGET }, { bin: FAKE_CLI, env: bare }),
    (error) => error instanceof BrightDataCliError && error.kind === 'auth',
  );
});

test('runScraper requires a target', async () => {
  await assert.rejects(
    () => runScraper({ collectorId: COLLECTOR }, opts),
    (error) => error instanceof BrightDataCliError && error.kind === 'validation',
  );
});
