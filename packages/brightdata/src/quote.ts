/**
 * Shell argument quoting.
 *
 * We are required to spawn with `shell: true` — on Windows the Bright Data CLI is a `.cmd` shim and
 * Node cannot exec it directly. But `shell: true` does NOT escape arguments; Node concatenates them
 * and hands the string to `cmd.exe`. Node itself warns about this (DEP0190).
 *
 * That is not a theoretical problem for us. Verified on Windows 11 / Node 24, spawning
 * `scraper run <id> "https://site/?layout=v2&pct=100"` unquoted produces:
 *
 *     argv received  → ["https://site/?layout=v2"]
 *     stderr         → 'pct' is not recognized as an internal or external command
 *
 * The URL is truncated at `&` and the remainder is *executed as a command*. Our Chaos Lab targets
 * are literally `?layout=v2` URLs, and heal diagnoses are free English containing spaces, commas
 * and quotes. So every argument goes through here first.
 *
 * Windows algorithm — the two-layer escape that `cmd.exe` requires:
 *   1. Apply the `CommandLineToArgvW` rules the *target program* parses with: double any backslashes
 *      that precede a quote, escape the quote, double trailing backslashes, wrap in quotes.
 *   2. Caret-escape every `cmd.exe` metacharacter, including the quotes added in step 1. `cmd`
 *      processes carets before it parses quoting, so it never enters quoted mode and never treats
 *      `&`, `|`, `>` or `%` as syntax — while the target program still sees well-formed quoting.
 *
 * Verified round-trip on Windows 11 / Node 24 for: query-string `&`, spaces, commas, embedded `"`,
 * `%PATH%` (not expanded), trailing backslashes, `|`, `>`, `&&`, `^`, `!` and the empty string.
 */

/** Every character `cmd.exe` treats as syntax. */
const WINDOWS_CMD_METACHARS = /([()\][%!^"`<>&|;, *?])/g;

/** Characters safe to leave bare in a POSIX shell. */
const POSIX_SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/;

/** Quote one argument for `cmd.exe` invoked via `spawn(..., { shell: true })`. */
export function quoteWindowsArg(arg: string): string {
  let out = arg;
  // Double any run of backslashes immediately before a quote, then escape the quote itself.
  out = out.replace(/(\\*)"/g, '$1$1\\"');
  // A trailing backslash would otherwise escape our own closing quote.
  out = out.replace(/(\\*)$/, '$1$1');
  out = `"${out}"`;
  // Caret-escape for cmd.exe. Applied last, over the quotes too — see the header note.
  out = out.replace(WINDOWS_CMD_METACHARS, '^$&');
  return out;
}

/** Quote one argument for `/bin/sh -c`. */
export function quotePosixArg(arg: string): string {
  if (arg === '') return "''";
  if (POSIX_SAFE.test(arg)) return arg;
  // Single quotes protect everything except a single quote, which must be closed, escaped, reopened.
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

export function quoteArg(arg: string, platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? quoteWindowsArg(arg) : quotePosixArg(arg);
}

/**
 * Quote a full argument vector.
 *
 * Every value that reaches `spawn` with `shell: true` must pass through this. Bypassing it for a
 * "safe-looking" value is how a `&` in a target URL becomes command execution.
 */
export function quoteArgv(
  argv: readonly string[],
  platform: NodeJS.Platform = process.platform,
): string[] {
  return argv.map((arg) => quoteArg(arg, platform));
}
