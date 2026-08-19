/**
 * Launcher: load `.env`, then start the worker.
 *
 * Exists for one reason — keeping secrets off the command line. Detaching a long-running process on
 * Windows means spawning it via WMI (`Win32_Process.Create`), because a process started any other
 * way stays inside the launching shell's Job Object and is killed when that job closes. WMI accepts
 * a command line but no environment block, so the obvious workaround is `cmd /c "set KEY=… && node
 * …"` — which writes BRIGHTDATA_API_KEY into the process table for every user on the machine to
 * read, and into whatever shell history or agent transcript issued it.
 *
 * So the environment is loaded here, in-process, from a file that is already gitignored. The
 * command line stays `node scripts/start-detached.mjs` and carries nothing sensitive.
 *
 *   node scripts/start-detached.mjs
 *
 * The worker itself deliberately has no dotenv dependency: it reads `process.env` and validates at
 * boot (see `src/config.ts`). That is right for a deployed worker, where the platform injects the
 * environment. This script is the local-development equivalent of that injection, which is why it
 * lives in `scripts/` rather than in `src/` — nothing in the shipped worker imports it.
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));

/**
 * Minimal `.env` reader.
 *
 * Not a dotenv clone: no interpolation, no multiline values, no `export` prefix. It handles the
 * shape `.env.example` actually documents — `KEY=value`, blank lines, `#` comments — and quietly
 * ignores anything else rather than guessing. Surrounding quotes are stripped because an operator
 * pasting a key will sometimes include them, and a quoted key fails authentication in a way that
 * looks exactly like a wrong key.
 */
function loadEnvFile(path) {
  if (!existsSync(path)) return 0;

  let loaded = 0;
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq <= 0) continue;

    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }

    // A real environment variable wins over the file: that is what makes it possible to override a
    // single setting for one run without editing `.env`.
    if (process.env[key] === undefined || process.env[key] === '') {
      process.env[key] = value;
      loaded += 1;
    }
  }
  return loaded;
}

loadEnvFile(here('../.env'));

// Importing the entry module runs it — `dist/index.js` calls `main()` at module scope. Any config
// error surfaces through the worker's own boot validation and its exit-78 path, not from here.
//
// `.href`, not a filesystem path: the ESM loader rejects a Windows absolute path outright
// (ERR_UNSUPPORTED_ESM_URL_SCHEME — it reads the drive letter as a URL scheme, `g:`). `fileURLToPath`
// above is correct for readFileSync and wrong here; the two take opposite forms.
await import(new URL('../dist/index.js', import.meta.url).href);
