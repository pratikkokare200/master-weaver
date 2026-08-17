/**
 * Shell-quoting tests.
 *
 * These are not unit tests against an expected string — they spawn a real child process through a
 * real shell with `shell: true` and assert that the argv the child *receives* is byte-identical to
 * what we passed. That is the only assertion that actually proves the escaping works, and it is the
 * bug that silently truncates Chaos Lab URLs at `&` if it regresses.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { quoteArg, quoteArgv, quotePosixArg, quoteWindowsArg } from '../dist/index.js';

const dir = mkdtempSync(join(tmpdir(), 'weaver-quote-'));
const echoScript = join(dir, 'echo-argv.mjs');
writeFileSync(echoScript, 'console.log(JSON.stringify(process.argv.slice(2)));\n');

after(() => {
  // Temp dir is small and OS-managed; nothing to tear down explicitly.
});

/** Spawn through a shell exactly the way the adapter does, and return the argv the child saw. */
function roundTrip(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', quoteArgv([echoScript, ...args]), {
      shell: true,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`child exited ${code}: ${stderr}`));
        return;
      }
      resolve(JSON.parse(stdout.trim()));
    });
  });
}

test('a query-string & survives the shell intact', async () => {
  // The regression that matters: unquoted, cmd.exe truncates this at `&` and executes `pct=100`.
  const args = ['https://master-weaver.vercel.app/?layout=v2&pct=100'];
  assert.deepEqual(await roundTrip(args), args);
});

test('heal diagnoses with spaces, commas and quotes survive', async () => {
  const args = [
    'Price and product name stopped extracting after a layout change',
    'Extract product name, price, RAM, storage, stock',
    'the "price" field returned empty on 70% of rows',
  ];
  assert.deepEqual(await roundTrip(args), args);
});

test('shell metacharacters are neutralised, not executed', async () => {
  const args = ['a|b>c&&d', 'semi;colon', '$(whoami)', '`whoami`', 'paren(s)', 'caret^and!bang!'];
  assert.deepEqual(await roundTrip(args), args);
});

test('environment variables are not expanded', async () => {
  const args = ['%PATH%', '%USERPROFILE%\\x', '$HOME', '${HOME}'];
  assert.deepEqual(await roundTrip(args), args);
});

test('backslashes and empty arguments survive', async () => {
  const args = ['back\\slash\\', 'C:\\Users\\admin\\', '', 'trailing\\\\'];
  assert.deepEqual(await roundTrip(args), args);
});

test('a full realistic heal argv survives', async () => {
  const args = [
    'scraper',
    'heal',
    'c_mswyapbp22wiwv8fhh',
    'The site layout changed from a table to a card grid. Fields "price" & "product_name" ' +
      'stopped extracting (fill rate 0.12, was 1.00).',
    '--url',
    'https://master-weaver-theta.vercel.app/?layout=v2',
    '--timeout',
    '300',
    '--json',
  ];
  assert.deepEqual(await roundTrip(args), args);
});

test('quoteArg dispatches on platform', () => {
  assert.equal(quoteArg('a b', 'win32'), quoteWindowsArg('a b'));
  assert.equal(quoteArg('a b', 'linux'), quotePosixArg('a b'));
});

test('posix quoting handles embedded single quotes', () => {
  assert.equal(quotePosixArg("it's"), "'it'\\''s'");
  assert.equal(quotePosixArg(''), "''");
  // Safe characters are left bare.
  assert.equal(quotePosixArg('https://example.com/a-b_c.d'), 'https://example.com/a-b_c.d');
});
