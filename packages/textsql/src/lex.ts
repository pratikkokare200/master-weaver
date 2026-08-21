/**
 * Just enough of a SQL lexer to tell code from text.
 *
 * Every check in `guard.ts` — "is there a second statement", "does this say DELETE" — is only sound
 * if it can tell a keyword from the same letters inside a string literal. A product name is
 * scraped from a page we do not control, so `where product_name = 'DROP TABLE runs;'` is a
 * perfectly legitimate query that a naive substring check rejects, and a naive check that ignores
 * quoting altogether can be walked past in the other direction.
 *
 * This is NOT a parser and does not try to be. It answers one question — which characters are code
 * and which are literal text — and it answers it the way Postgres does, including the four quoting
 * forms that actually appear:
 *
 *   'text'            with '' doubling
 *   E'text'           with backslash escapes
 *   "identifier"      with "" doubling
 *   $tag$ text $tag$  dollar quoting, where nothing inside is escaped at all
 *
 * plus `--` line comments and `/* *\/` block comments, which nest in Postgres.
 */

export interface Lexed {
  /**
   * The statement with every literal, identifier and comment blanked to spaces, positions
   * preserved. Keyword scanning runs against this: offsets still line up with the original, and
   * nothing inside quotes can be mistaken for code.
   */
  readonly code: string;
  /** Offsets of semicolons that are actually statement separators. */
  readonly semicolons: readonly number[];
  /** True if a quote or comment was still open at the end — a truncated or malformed statement. */
  readonly unterminated: boolean;
}

const SPACE = ' ';

function blank(length: number): string {
  return SPACE.repeat(length);
}

export function lex(sql: string): Lexed {
  let code = '';
  const semicolons: number[] = [];
  let i = 0;
  let unterminated = false;

  const n = sql.length;

  while (i < n) {
    const ch = sql[i] as string;
    const next = sql[i + 1];

    // -- line comment
    if (ch === '-' && next === '-') {
      const end = sql.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      code += blank(stop - i);
      i = stop;
      continue;
    }

    // /* block comment */ — nesting, as Postgres does it
    if (ch === '/' && next === '*') {
      let depth = 1;
      let j = i + 2;
      while (j < n && depth > 0) {
        if (sql[j] === '/' && sql[j + 1] === '*') {
          depth += 1;
          j += 2;
        } else if (sql[j] === '*' && sql[j + 1] === '/') {
          depth -= 1;
          j += 2;
        } else {
          j += 1;
        }
      }
      if (depth > 0) unterminated = true;
      code += blank(Math.min(j, n) - i);
      i = j;
      continue;
    }

    // $tag$ dollar-quoted string. Nothing inside is escaped, which is what makes it the favourite
    // way to smuggle a quote past a check that only knows about '.
    if (ch === '$') {
      const tag = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (tag) {
        const marker = tag[0];
        const close = sql.indexOf(marker, i + marker.length);
        const stop = close === -1 ? n : close + marker.length;
        if (close === -1) unterminated = true;
        code += blank(stop - i);
        i = stop;
        continue;
      }
    }

    // E'…' — backslash escapes are live inside it.
    if ((ch === 'E' || ch === 'e') && next === "'") {
      let j = i + 2;
      let closed = false;
      while (j < n) {
        if (sql[j] === '\\') {
          j += 2;
          continue;
        }
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") {
            j += 2;
            continue;
          }
          j += 1;
          closed = true;
          break;
        }
        j += 1;
      }
      if (!closed) unterminated = true;
      code += blank(Math.min(j, n) - i);
      i = j;
      continue;
    }

    // '…' with '' doubling
    if (ch === "'") {
      let j = i + 1;
      let closed = false;
      while (j < n) {
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") {
            j += 2;
            continue;
          }
          j += 1;
          closed = true;
          break;
        }
        j += 1;
      }
      if (!closed) unterminated = true;
      code += blank(Math.min(j, n) - i);
      i = j;
      continue;
    }

    // "identifier" with "" doubling. Blanked like a literal: a quoted identifier cannot be a
    // keyword, so nothing in it should ever match one.
    if (ch === '"') {
      let j = i + 1;
      let closed = false;
      while (j < n) {
        if (sql[j] === '"') {
          if (sql[j + 1] === '"') {
            j += 2;
            continue;
          }
          j += 1;
          closed = true;
          break;
        }
        j += 1;
      }
      if (!closed) unterminated = true;
      code += blank(Math.min(j, n) - i);
      i = j;
      continue;
    }

    if (ch === ';') semicolons.push(i);
    code += ch;
    i += 1;
  }

  return { code, semicolons, unterminated };
}
