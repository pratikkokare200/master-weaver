/**
 * The subprocess boundary.
 *
 * The Bright Data CLI has no Node SDK, so every call is a child process. Doc 01 §6.2 sets the
 * discipline this module implements:
 *
 *   - spawn with `shell: true` (Windows resolves the `.cmd` shim, not a bare binary)
 *   - always pass `--json`
 *   - capture stdout and stderr **separately**
 *   - hard timeout per call, killing the process **tree** on expiry
 *   - `BRIGHTDATA_API_KEY` from env, never an interactive login on the server
 *   - log the exact argv with the key redacted
 *
 * Two Windows-specific hazards are handled here, both verified empirically on Windows 11 / Node 24
 * rather than assumed:
 *
 *   1. `shell: true` does not escape arguments — see `quote.ts`. Every argument is quoted.
 *   2. `child.kill()` kills only the `cmd.exe` wrapper and orphans the real process. Measured: a
 *      grandchild kept running and writing for the full 60s after `kill()` returned. `taskkill /T /F`
 *      terminates the tree correctly, and is what a timeout uses.
 */

import { execFile, spawn } from 'node:child_process';

import {
  AUTO_SAVE_ALLOWED_ON,
  AUTO_SAVE_FLAG,
  FORBIDDEN_FLAGS,
  KILL_GRACE_MS,
  MAX_OUTPUT_BYTES,
  SIGKILL_GRACE_MS,
  STDERR_EXCERPT_CHARS,
  resolveBin,
} from './config.js';
import { quoteArg, quoteArgv } from './quote.js';
import { collectSecrets, formatArgvRedacted, redactText } from './redact.js';
import { BrightDataCliError, type CliResult } from './types.js';

/** Only redacted data is ever passed to a logger. */
export interface CliLogEvent {
  phase: 'start' | 'finish';
  command: string;
  argvRedacted: string;
  durationMs?: number;
  exitCode?: number | null;
  timedOut?: boolean;
  ok?: boolean;
}

export type CliLogger = (event: CliLogEvent) => void;

export interface RunCliOptions {
  /** Argument vector *without* the binary, e.g. `['scraper', 'run', id, url, '--json']`. */
  argv: string[];
  /** Label for logs and metrics, e.g. `scraper heal`. */
  command: string;
  /** Hard deadline. The process tree is killed at `timeoutMs + KILL_GRACE_MS`. */
  timeoutMs: number;
  bin?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Caller-side cancellation, in addition to the timeout. */
  signal?: AbortSignal;
  maxOutputBytes?: number;
  logger?: CliLogger;
}

const ANSI_PATTERN = /\[[0-9;?]*[ -/]*[@-~]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '');
}

/**
 * Guard against the flags we never send.
 *
 * The heal wrapper does not pass `--auto-approve`, but this check sits at the boundary every call
 * funnels through, so no future caller can reintroduce it by hand-rolling an argv.
 *
 * `--auto-save` is judged against the command rather than banned outright — see
 * {@link AUTO_SAVE_FLAG}. The command is read from the argv itself rather than taken as a parameter,
 * deliberately: an `allowAutoSave` argument would be one more thing a caller could pass by hand,
 * which is the exact hole this function exists to close.
 */
export function assertNoForbiddenFlags(argv: readonly string[]): void {
  const isApprove = AUTO_SAVE_ALLOWED_ON.every((word, i) => argv[i] === word);

  for (const arg of argv) {
    const flag = arg.split('=')[0] ?? arg;

    if ((FORBIDDEN_FLAGS as readonly string[]).includes(flag)) {
      throw new BrightDataCliError(
        'forbidden_flag',
        `Refusing to invoke the Bright Data CLI with ${flag}. Standing at the approval gate is the ` +
          `product — see the comment in commands.ts › healScraper.`,
      );
    }

    if (flag === AUTO_SAVE_FLAG && !isApprove) {
      throw new BrightDataCliError(
        'forbidden_flag',
        `Refusing to invoke \`${argv.slice(0, 2).join(' ')}\` with ${AUTO_SAVE_FLAG}. It is ` +
          `permitted only on \`scraper approve\`, where the canary has already cleared the gate.`,
      );
    }
  }
}

/**
 * Parse the CLI's JSON output.
 *
 * `--json` is always passed, but the CLI may still emit progress lines or ANSI escapes ahead of the
 * payload, so parsing degrades gracefully instead of trusting the whole buffer to be JSON.
 */
export function parseCliJson<T>(stdout: string): { ok: true; value: T } | { ok: false; reason: string } {
  const clean = stripAnsi(stdout).trim();
  if (clean === '') return { ok: false, reason: 'empty stdout' };

  const attempt = (candidate: string): { ok: true; value: T } | null => {
    try {
      return { ok: true, value: JSON.parse(candidate) as T };
    } catch {
      return null;
    }
  };

  const whole = attempt(clean);
  if (whole) return whole;

  // Progress chatter followed by the payload on the final line.
  const lines = clean.split(/\r?\n/).filter((line) => line.trim() !== '');
  const lastLine = lines[lines.length - 1];
  if (lastLine !== undefined) {
    const tail = attempt(lastLine.trim());
    if (tail) return tail;
  }

  // Payload embedded in surrounding noise: take the outermost bracket pair.
  const firstObject = clean.indexOf('{');
  const firstArray = clean.indexOf('[');
  const candidates: Array<[number, number]> = [];
  if (firstArray !== -1) candidates.push([firstArray, clean.lastIndexOf(']')]);
  if (firstObject !== -1) candidates.push([firstObject, clean.lastIndexOf('}')]);
  candidates.sort((a, b) => a[0] - b[0]);

  for (const [start, end] of candidates) {
    if (start === -1 || end <= start) continue;
    const sliced = attempt(clean.slice(start, end + 1));
    if (sliced) return sliced;
  }

  return { ok: false, reason: 'stdout was not parseable JSON' };
}

/** Credentials missing or rejected — quarantine, do not attempt a heal (doc 01 §11). */
function looksLikeAuthFailure(stderr: string, stdout: string): boolean {
  const haystack = `${stderr}\n${stdout}`.toLowerCase();
  return (
    haystack.includes('unauthorized') ||
    haystack.includes('unauthenticated') ||
    haystack.includes('invalid api key') ||
    haystack.includes('missing api key') ||
    haystack.includes('not logged in') ||
    haystack.includes('authentication failed') ||
    /\b401\b/.test(haystack) ||
    /\b403\b/.test(haystack)
  );
}

/**
 * Kill the whole process tree.
 *
 * On Windows `child.kill()` reaches only the `cmd.exe` shim we spawned through; the CLI's own
 * `node` process survives it. `taskkill /T /F` is the only reliable option, and is verified to work.
 * On POSIX the child is spawned detached so it leads its own process group, which we signal via the
 * negative pid.
 */
function killTree(pid: number | undefined): void {
  if (pid === undefined) return;

  if (process.platform === 'win32') {
    execFile('taskkill', ['/pid', String(pid), '/T', '/F'], () => {
      // Non-zero here just means the tree had already exited.
    });
    return;
  }

  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    // Already gone.
  }
  setTimeout(() => {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }, SIGKILL_GRACE_MS).unref();
}

/** Accumulates a stream with a hard byte cap. */
class CappedBuffer {
  private readonly chunks: Buffer[] = [];
  private readonly limit: number;
  private size = 0;
  truncated = false;

  constructor(limit: number) {
    this.limit = limit;
  }

  push(chunk: Buffer): void {
    if (this.size >= this.limit) {
      this.truncated = true;
      return;
    }
    const room = this.limit - this.size;
    if (chunk.length > room) {
      this.chunks.push(chunk.subarray(0, room));
      this.size = this.limit;
      this.truncated = true;
      return;
    }
    this.chunks.push(chunk);
    this.size += chunk.length;
  }

  toString(): string {
    return Buffer.concat(this.chunks).toString('utf8');
  }
}

/**
 * Invoke the CLI once and resolve with a complete, redacted result.
 *
 * Never rejects for a CLI-level failure — a failed call is a result with `ok: false` and a populated
 * `error`, because the worker has to write a ledger row for it either way. It only throws for
 * programming errors caught before spawning (a forbidden flag).
 */
export async function runCli<T>(options: RunCliOptions): Promise<CliResult<T>> {
  const {
    argv,
    command,
    timeoutMs,
    cwd,
    signal,
    logger,
    maxOutputBytes = MAX_OUTPUT_BYTES,
  } = options;

  const env = options.env ?? process.env;
  const bin = options.bin ?? resolveBin(env);
  const secrets = collectSecrets(env);
  const argvRedacted = formatArgvRedacted(bin, argv, secrets);

  assertNoForbiddenFlags(argv);

  const startedAt = Date.now();
  logger?.({ phase: 'start', command, argvRedacted });

  const finish = (result: CliResult<T>): CliResult<T> => {
    logger?.({
      phase: 'finish',
      command,
      argvRedacted,
      durationMs: result.durationMs,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      ok: result.ok,
    });
    return result;
  };

  if (signal?.aborted) {
    return finish({
      ok: false,
      data: null,
      raw: null,
      command,
      argvRedacted,
      exitCode: null,
      signal: null,
      timedOut: false,
      durationMs: 0,
      stdout: '',
      stderr: '',
      stderrExcerpt: '',
      truncated: false,
      error: new BrightDataCliError('spawn', 'Aborted before spawn', { argvRedacted }),
    });
  }

  return new Promise<CliResult<T>>((resolve) => {
    // `shell: true` is mandatory for the Windows `.cmd` shim; every argument is quoted first
    // because the shell option performs no escaping of its own.
    const quotedBin = /\s/.test(bin) ? quoteArg(bin) : bin;
    const child = spawn(quotedBin, quoteArgv(argv), {
      shell: true,
      cwd,
      env: {
        ...env,
        // Belt and braces: `--json` should already suppress decoration off-TTY.
        NO_COLOR: '1',
        FORCE_COLOR: '0',
      },
      windowsHide: true,
      // POSIX only: makes the child a process-group leader so the whole group can be signalled.
      // On Windows this would spawn a detached console window, and `taskkill /T` covers us instead.
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stdout = new CappedBuffer(maxOutputBytes);
    const stderr = new CappedBuffer(maxOutputBytes);
    let timedOut = false;
    let settled = false;

    const killTimer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
    }, timeoutMs + KILL_GRACE_MS);

    const onAbort = (): void => {
      killTree(child.pid);
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    const cleanup = (): void => {
      clearTimeout(killTimer);
      signal?.removeEventListener('abort', onAbort);
    };

    child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk));

    const settle = (
      exitCode: number | null,
      exitSignal: NodeJS.Signals | null,
      spawnError?: Error,
    ): void => {
      if (settled) return;
      settled = true;
      cleanup();

      const durationMs = Date.now() - startedAt;
      const outText = redactText(stdout.toString(), secrets);
      const errText = redactText(stderr.toString(), secrets);
      const stderrExcerpt = errText.slice(0, STDERR_EXCERPT_CHARS);
      const truncated = stdout.truncated || stderr.truncated;

      const base = {
        command,
        argvRedacted,
        exitCode,
        signal: exitSignal,
        timedOut,
        durationMs,
        stdout: outText,
        stderr: errText,
        stderrExcerpt,
        truncated,
      };

      const fail = (error: BrightDataCliError): void => {
        resolve(finish({ ...base, ok: false, data: null, raw: null, error }));
      };

      if (spawnError) {
        fail(
          new BrightDataCliError('spawn', `Failed to start ${bin}: ${spawnError.message}`, {
            argvRedacted,
            stderrExcerpt,
            durationMs,
            cause: spawnError,
          }),
        );
        return;
      }

      if (timedOut) {
        fail(
          new BrightDataCliError(
            'timeout',
            `${command} exceeded ${timeoutMs}ms and its process tree was killed`,
            { exitCode, argvRedacted, stderrExcerpt, durationMs },
          ),
        );
        return;
      }

      if (looksLikeAuthFailure(errText, outText)) {
        fail(
          new BrightDataCliError(
            'auth',
            `${command} failed to authenticate. Check BRIGHTDATA_API_KEY — this is not a healing case.`,
            { exitCode, argvRedacted, stderrExcerpt, durationMs },
          ),
        );
        return;
      }

      if (exitCode !== 0) {
        fail(
          new BrightDataCliError(
            'exit',
            `${command} exited with code ${exitCode ?? 'null'}${
              stderrExcerpt ? `: ${stderrExcerpt.split('\n')[0] ?? ''}` : ''
            }`,
            { exitCode, argvRedacted, stderrExcerpt, durationMs },
          ),
        );
        return;
      }

      const parsed = parseCliJson<T>(outText);
      if (!parsed.ok) {
        fail(
          new BrightDataCliError('parse', `${command} succeeded but ${parsed.reason}`, {
            exitCode,
            argvRedacted,
            stderrExcerpt,
            durationMs,
          }),
        );
        return;
      }

      resolve(
        finish({ ...base, ok: true, data: parsed.value, raw: parsed.value, error: null }),
      );
    };

    child.on('error', (error: Error) => settle(null, null, error));
    child.on('close', (code, exitSignal) => settle(code, exitSignal));
  });
}
