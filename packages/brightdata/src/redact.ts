/**
 * Secret redaction.
 *
 * Doc 01 §6.2: "log the exact argv (with the key redacted) into the ledger — reproducibility is a
 * clean-code point." The redacted argv is persisted to `healing_attempts.cli_argv_redacted` and the
 * stderr excerpt to `healing_attempts.stderr_excerpt`, both of which are rendered in the dashboard.
 * Anything that leaves this package has been through here first.
 *
 * We authenticate via the `BRIGHTDATA_API_KEY` environment variable and never put the key in argv,
 * but the CLI also accepts a global `-k, --api-key <key>` flag — so we redact both the known secret
 * value *and* that flag's argument, in case a future caller uses it.
 */

export const REDACTED = '***REDACTED***';

/**
 * Below this length a "secret" is more likely to be a common substring than a key; replacing it
 * everywhere would corrupt the logs rather than protect anything.
 */
const MIN_SECRET_LENGTH = 8;

/** Flags whose *following* argument is a secret. */
const SECRET_FLAGS = new Set(['-k', '--api-key', '--api_key']);

/** `--api-key=value` / `-k=value` / `--api-key value` in free text (e.g. an error message). */
const SECRET_FLAG_PATTERN = /(--api[-_]?key|(?<![\w-])-k)([=\s]+)(\S+)/gi;

/** Read the secrets worth redacting out of an environment. */
export function collectSecrets(env: NodeJS.ProcessEnv = process.env): string[] {
  const secrets: string[] = [];
  const apiKey = env['BRIGHTDATA_API_KEY'];
  if (typeof apiKey === 'string' && apiKey.length >= MIN_SECRET_LENGTH) {
    secrets.push(apiKey);
  }
  return secrets;
}

/**
 * Redact secrets from arbitrary text — stdout, stderr, error messages.
 *
 * Literal substring replacement, not regex, so a key containing regex metacharacters is handled
 * correctly.
 */
export function redactText(text: string, secrets: readonly string[] = collectSecrets()): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length < MIN_SECRET_LENGTH) continue;
    out = out.split(secret).join(REDACTED);
  }
  return out.replace(SECRET_FLAG_PATTERN, `$1$2${REDACTED}`);
}

/**
 * Redact an argument vector, element by element.
 *
 * Handles both `--api-key <value>` (two elements) and `--api-key=<value>` (one), plus any element
 * that happens to contain the key.
 */
export function redactArgv(
  argv: readonly string[],
  secrets: readonly string[] = collectSecrets(),
): string[] {
  const out: string[] = [];
  let redactNextValue = false;

  for (const arg of argv) {
    if (redactNextValue) {
      out.push(REDACTED);
      redactNextValue = false;
      continue;
    }

    if (SECRET_FLAGS.has(arg)) {
      out.push(arg);
      redactNextValue = true;
      continue;
    }

    const eq = arg.indexOf('=');
    if (eq > 0 && SECRET_FLAGS.has(arg.slice(0, eq))) {
      out.push(`${arg.slice(0, eq)}=${REDACTED}`);
      continue;
    }

    out.push(redactText(arg, secrets));
  }

  return out;
}

/**
 * Render a full command line for the ledger — safe to persist and to display.
 *
 * Quotes any element containing whitespace so the line stays copy-pasteable for reproduction.
 */
export function formatArgvRedacted(
  bin: string,
  argv: readonly string[],
  secrets: readonly string[] = collectSecrets(),
): string {
  const parts = [bin, ...redactArgv(argv, secrets)];
  return parts.map((p) => (/\s/.test(p) ? JSON.stringify(p) : p)).join(' ');
}
