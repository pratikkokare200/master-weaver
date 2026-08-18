/**
 * Configuration tests.
 *
 * The worker is deployed by pasting values into a platform dashboard, so the failure mode worth
 * guarding is a typo that boots successfully and misbehaves quietly. Everything here is about
 * refusing to start instead.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BREAKER_LIMITS } from '@weaver/contracts';

import { ConfigError, loadConfig, resolveSsl } from '../dist/config.js';

const MINIMAL = {
  DATABASE_URL: 'postgresql://user:pw@db.abcdefg.supabase.co:5432/postgres',
  BRIGHTDATA_API_KEY: 'bd_test_key',
};

test('a minimal environment produces sensible defaults', () => {
  const config = loadConfig({ ...MINIMAL }, { hostname: 'railway', pid: 42 });

  assert.equal(config.pollIntervalMs, 10_000);
  assert.equal(config.cronIntervalMs, 30 * 60_000, 'the price cron is 30 minutes');
  assert.equal(config.cronOnBoot, false);
  assert.equal(config.maxAttempts, BREAKER_LIMITS.TRANSIENT_RETRIES + 1);
  assert.match(config.workerId, /^railway#42#[a-z0-9]{6}$/);
});

test('a missing DATABASE_URL is a boot failure, with the reason', () => {
  assert.throws(() => loadConfig({ BRIGHTDATA_API_KEY: 'k' }), (error) => {
    assert.ok(error instanceof ConfigError);
    assert.match(error.message, /FOR UPDATE SKIP LOCKED/);
    return true;
  });
});

test('SUPABASE_DB_URL is accepted as an alias', () => {
  const config = loadConfig({ SUPABASE_DB_URL: MINIMAL.DATABASE_URL, BRIGHTDATA_API_KEY: 'k' });
  assert.equal(config.databaseUrl, MINIMAL.DATABASE_URL);
});

test('a missing API key is a boot failure unless stored credentials are allowed', () => {
  assert.throws(() => loadConfig({ DATABASE_URL: MINIMAL.DATABASE_URL }), /BRIGHTDATA_API_KEY/);

  const local = loadConfig({
    DATABASE_URL: MINIMAL.DATABASE_URL,
    BRIGHTDATA_ALLOW_STORED_CREDENTIALS: 'true',
  });
  assert.equal(local.allowStoredCredentials, true);
});

test('malformed numbers and booleans are rejected, not coerced', () => {
  assert.throws(() => loadConfig({ ...MINIMAL, WORKER_POLL_INTERVAL_MS: 'ten' }), /must be an integer/);
  assert.throws(() => loadConfig({ ...MINIMAL, WORKER_POLL_INTERVAL_MS: '1.5' }), /must be an integer/);
  assert.throws(() => loadConfig({ ...MINIMAL, WORKER_POLL_INTERVAL_MS: '10' }), /at least 250/);
  assert.throws(() => loadConfig({ ...MINIMAL, WORKER_CRON_ON_BOOT: 'sometimes' }), /must be a boolean/);
  assert.throws(() => loadConfig({ ...MINIMAL, LOG_LEVEL: 'chatty' }), /LOG_LEVEL/);
});

test('an empty string falls back to the default rather than failing', () => {
  const config = loadConfig({ ...MINIMAL, WORKER_POLL_INTERVAL_MS: '', LOG_LEVEL: '' });
  assert.equal(config.pollIntervalMs, 10_000);
  assert.equal(config.logLevel, 'info');
});

test('TLS is on for a remote database and off for a local one', () => {
  assert.deepEqual(resolveSsl(MINIMAL.DATABASE_URL, {}), { rejectUnauthorized: true });
  assert.equal(resolveSsl('postgresql://postgres@localhost:5432/postgres', {}), false);
  assert.equal(resolveSsl('postgresql://postgres@127.0.0.1:54322/postgres', {}), false);
});

test('certificate verification can be relaxed explicitly, and only explicitly', () => {
  assert.deepEqual(
    resolveSsl(MINIMAL.DATABASE_URL, { DATABASE_SSL_REJECT_UNAUTHORIZED: 'false' }),
    { rejectUnauthorized: false },
  );
  assert.equal(resolveSsl(MINIMAL.DATABASE_URL, { DATABASE_SSL: 'false' }), false);
});

test('an unparseable DATABASE_URL is caught at boot', () => {
  assert.throws(() => loadConfig({ ...MINIMAL, DATABASE_URL: 'not a url' }), /valid connection URL/);
});

test('the pool size is tunable for a project near its connection cap', () => {
  assert.equal(loadConfig({ ...MINIMAL }).dbPoolMax, 4);
  assert.equal(loadConfig({ ...MINIMAL, WORKER_DB_POOL_MAX: '1' }).dbPoolMax, 1);
  assert.throws(() => loadConfig({ ...MINIMAL, WORKER_DB_POOL_MAX: '0' }), /at least 1/);
});
