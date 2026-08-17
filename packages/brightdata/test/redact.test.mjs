/**
 * Redaction tests.
 *
 * The redacted argv is persisted to `healing_attempts.cli_argv_redacted` and rendered in the
 * dashboard, so a leak here is a leak into the database and onto the screen.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { REDACTED, collectSecrets, formatArgvRedacted, redactArgv, redactText } from '../dist/index.js';

const KEY = 'bd_live_9f3a17c04e8b42d1a6';
const ENV = { BRIGHTDATA_API_KEY: KEY };

test('the API key value is redacted wherever it appears in text', () => {
  const text = `request failed with key ${KEY} (retrying)`;
  const out = redactText(text, collectSecrets(ENV));
  assert.ok(!out.includes(KEY), 'key must not survive redaction');
  assert.ok(out.includes(REDACTED));
});

test('the API key is redacted from stderr even when embedded in a URL', () => {
  const text = `GET https://api.brightdata.com/v1?token=${KEY}&zone=x`;
  const out = redactText(text, collectSecrets(ENV));
  assert.ok(!out.includes(KEY));
});

test('--api-key and -k flag values are redacted even when the key is unknown', () => {
  // Covers a key that never passed through our env — we still must not log it.
  for (const line of [
    '--api-key sk-unknown-value',
    '--api-key=sk-unknown-value',
    '-k sk-unknown-value',
    '--api_key sk-unknown-value',
  ]) {
    const out = redactText(line, []);
    assert.ok(!out.includes('sk-unknown-value'), `leaked in: ${line} -> ${out}`);
    assert.ok(out.includes(REDACTED));
  }
});

test('redactArgv redacts the value following a secret flag', () => {
  const argv = ['scraper', 'run', 'c_abc', '--api-key', KEY, '--json'];
  const out = redactArgv(argv, collectSecrets(ENV));
  assert.deepEqual(out, ['scraper', 'run', 'c_abc', '--api-key', REDACTED, '--json']);
});

test('redactArgv handles the --flag=value form', () => {
  const out = redactArgv(['scraper', 'run', `--api-key=${KEY}`], collectSecrets(ENV));
  assert.deepEqual(out, ['scraper', 'run', `--api-key=${REDACTED}`]);
});

test('redactArgv redacts a key that leaked into an unrelated argument', () => {
  const out = redactArgv(['scrape', `https://x.dev/?t=${KEY}`], collectSecrets(ENV));
  assert.ok(!out.join(' ').includes(KEY));
});

test('short values are not treated as secrets', () => {
  // Guard against redacting a 3-char "key" everywhere and destroying the logs.
  const secrets = collectSecrets({ BRIGHTDATA_API_KEY: 'abc' });
  assert.deepEqual(secrets, []);
  assert.equal(redactText('abc def abc', secrets), 'abc def abc');
});

test('collectSecrets ignores a missing key', () => {
  assert.deepEqual(collectSecrets({}), []);
});

test('formatArgvRedacted produces a copy-pasteable, secret-free command line', () => {
  const line = formatArgvRedacted(
    'brightdata',
    ['scraper', 'heal', 'c_abc', 'price stopped extracting', '--json'],
    collectSecrets(ENV),
  );
  assert.equal(line, 'brightdata scraper heal c_abc "price stopped extracting" --json');
  assert.ok(!line.includes(KEY));
});
