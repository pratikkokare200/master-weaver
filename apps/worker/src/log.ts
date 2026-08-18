/**
 * Structured logging.
 *
 * One JSON object per line on stdout, because the worker's destination is a platform log drain
 * (Railway / Fly / Render, doc 03 section 3.4) rather than a terminal someone is watching. A line
 * that greps cleanly is worth more here than one that reads nicely.
 *
 * Nothing in this module formats a secret: the CLI adapter hands us pre-redacted argv, and the
 * database URL is never logged, only its host.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  /** Derive a logger that stamps every line with extra fields, e.g. the job id. */
  child(fields: Record<string, unknown>): Logger;
}

/** Errors do not survive JSON.stringify, so unpack the parts worth keeping. */
function encodeValue(value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  return value;
}

export interface LoggerOptions {
  level?: LogLevel;
  base?: Record<string, unknown>;
  /** Injectable for tests. */
  write?: (line: string) => void;
  now?: () => Date;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? 'info';
  const base = options.base ?? {};
  const write = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const now = options.now ?? (() => new Date());

  function emit(at: LogLevel, message: string, fields?: Record<string, unknown>): void {
    if (LEVEL_RANK[at] < LEVEL_RANK[level]) return;

    const payload: Record<string, unknown> = {
      t: now().toISOString(),
      level: at,
      msg: message,
      ...base,
    };
    for (const [key, value] of Object.entries(fields ?? {})) payload[key] = encodeValue(value);

    try {
      write(JSON.stringify(payload));
    } catch {
      // A field that cannot be serialised (a cycle, a BigInt) must not take the worker down.
      write(JSON.stringify({ t: now().toISOString(), level: at, msg: message, ...base, unserialisable: true }));
    }
  }

  return {
    debug: (message, fields) => emit('debug', message, fields),
    info: (message, fields) => emit('info', message, fields),
    warn: (message, fields) => emit('warn', message, fields),
    error: (message, fields) => emit('error', message, fields),
    child: (fields) => createLogger({ ...options, base: { ...base, ...fields } }),
  };
}

/** A logger that discards everything. For tests that are not asserting on output. */
export const silentLogger: Logger = createLogger({ level: 'error', write: () => {} });
