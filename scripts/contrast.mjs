#!/usr/bin/env node
/**
 * The contrast script doc 05 keeps referring to.
 *
 * `app/globals.css` says of its palette that "every value below was checked with a contrast script
 * before it landed. The ratios in the comments are measured, not aspirational." This is that
 * script, so the claim is checkable rather than a matter of trust — and so the teal pass could be
 * *tuned* against measurements instead of eyeballed and hoped for.
 *
 * It reads the tokens straight out of `apps/web/app/globals.css` rather than keeping its own copy.
 * A checker with a duplicated palette passes happily while the stylesheet it is meant to be
 * guarding drifts underneath it.
 *
 *   node scripts/contrast.mjs          # check every declared pair, exit 1 on a failure
 *   node scripts/contrast.mjs --hues   # also print the hue wheel, for the reserved-hue rule
 *
 * Thresholds are WCAG 2.1 AA: 4.5:1 for body text, 3:1 for large text and for graphical objects
 * (a status dot, a chart line, a focus ring, the edge of a control).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const CSS = join(HERE, '..', 'apps', 'web', 'app', 'globals.css');

// --- colour maths ------------------------------------------------------------------------------

function parseHex(hex) {
  const value = hex.trim().replace('#', '');
  const full =
    value.length === 3
      ? value
          .split('')
          .map((c) => c + c)
          .join('')
      : value;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/** WCAG relative luminance. The 0.03928 branch is the sRGB transfer curve, not a fudge factor. */
function luminance(hex) {
  const [r, g, b] = parseHex(hex).map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

/** Hue in degrees. Used only for the reserved-hue rule in doc 05 §2.2. */
function hue(hex) {
  const [r, g, b] = parseHex(hex).map((c) => c / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return null; // a true neutral has no hue — that was charcoal's whole argument
  let h;
  if (max === r) h = ((g - b) / delta) % 6;
  else if (max === g) h = (b - r) / delta + 2;
  else h = (r - g) / delta + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

function saturation(hex) {
  const [r, g, b] = parseHex(hex).map((c) => c / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

// --- tokens ------------------------------------------------------------------------------------

/**
 * Pull `--name: #rrggbb;` out of the `:root` block. Non-hex values (the scrim's rgb(), the font
 * stacks, the radii) are skipped rather than guessed at.
 */
function readTokens() {
  // Comments come out first. `globals.css` explains its own tokens at length, and those paragraphs
  // mention both `:root` and `@theme inline` well before either block is actually opened — slicing
  // on the raw text finds the prose, not the declarations.
  const css = readFileSync(CSS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const root = css.slice(css.indexOf(':root'), css.indexOf('@theme inline'));
  const tokens = {};
  for (const match of root.matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
    tokens[match[1]] = match[2].toLowerCase();
  }
  return tokens;
}

/**
 * Every pair that has to hold, named the way the stylesheet's comments name them.
 *
 * `min` is the threshold that applies to what the pair is actually *for*: 4.5 where the foreground
 * is text, 3.0 where it is a dot, a line, a ring or an edge. A pair listed at 3.0 is not a relaxed
 * requirement — it is a different requirement.
 */
const PAIRS = [
  // ink on surfaces
  ['ink', 'surface', 4.5, 'primary ink on card'],
  ['ink', 'plane', 4.5, 'primary ink on page'],
  ['ink-secondary', 'surface', 4.5, 'secondary ink on card'],
  ['ink-secondary', 'plane', 4.5, 'secondary ink on page'],
  ['ink-muted', 'surface', 4.5, 'meta / axis on card'],
  ['ink-muted', 'plane', 4.5, 'meta / axis on page'],

  // the accent, in every register it is used in
  ['accent', 'surface', 4.5, 'link text, active tab label on card'],
  ['accent', 'plane', 4.5, 'accent ink on page plane'],
  ['accent-hover', 'surface', 4.5, 'hovered link'],
  ['accent-ink', 'accent-fill', 4.5, 'primary button label'],
  ['accent-ink', 'accent-fill-hover', 4.5, 'primary button label, hovered'],
  ['accent', 'accent-plane', 4.5, 'active nav / tour chip label on its wash'],
  ['accent', 'accent-plane-strong', 4.5, 'the same label at the pulse peak'],
  ['accent-fill', 'surface', 3.0, 'the button as a shape against the card'],
  ['accent-fill', 'plane', 3.0, 'the button as a shape against the page'],
  ['accent', 'accent-plane-border', 3.0, 'focus ring against the chip edge'],

  // status — text first, then the same hues as marks
  ['success', 'surface', 4.5, 'success text on card'],
  ['success', 'plane', 4.5, 'success text on page'],
  ['success-ink', 'success-plane', 4.5, 'success label on its wash'],
  ['healing-ink', 'healing-plane', 4.5, 'healing label on its wash'],
  ['status-critical', 'surface', 4.5, 'critical text on card'],
  ['status-critical', 'status-critical-plane', 4.5, 'critical label on its wash'],
  ['status-good', 'surface', 3.0, 'the good dot as a graphical object'],
  ['status-warning', 'surface', 3.0, 'the healing dot as a graphical object'],
  ['status-critical', 'surface', 3.0, 'the critical dot as a graphical object'],

  // floating layers
  ['tooltip-ink', 'tooltip-plane', 4.5, 'tooltip text'],
];

/**
 * Washes have a second job contrast ratios do not measure: separating themselves from the plane
 * they sit on. Too low and the active nav row is invisible; this is the floor that failed for the
 * old cerulean wash (1.12:1) and passed for the charcoal one (1.21:1).
 */
const SEPARATION = [
  ['accent-plane', 'plane', 1.15, 'active nav wash against the page'],
  ['accent-plane-border', 'plane', 1.3, 'the tour chip edge against the page'],
  ['hairline', 'surface', 1.1, 'a hairline against the card it divides'],
];

// --- report ------------------------------------------------------------------------------------

const tokens = readTokens();
let failed = 0;

function row(fgName, bgName, min, note, kind) {
  const fg = tokens[fgName];
  const bg = tokens[bgName];
  if (!fg || !bg) {
    console.log(`  ??  ${fgName} on ${bgName} — token missing`);
    failed += 1;
    return;
  }
  const ratio = contrast(fg, bg);
  const ok = ratio >= min;
  if (!ok) failed += 1;
  const mark = ok ? 'ok ' : 'FAIL';
  console.log(
    `  ${mark} ${ratio.toFixed(2).padStart(5)}:1  (min ${min.toFixed(2)})  ` +
      `${fgName} ${kind} ${bgName}  — ${note}`,
  );
}

console.log(`\nMaster Weaver — contrast check\n${CSS}\n`);

console.log('WCAG AA pairs');
for (const [fg, bg, min, note] of PAIRS) row(fg, bg, min, note, 'on');

console.log('\nSeparation floors (a wash has to be visible, not just legible)');
for (const [fg, bg, min, note] of SEPARATION) row(fg, bg, min, note, 'vs');

if (process.argv.includes('--hues')) {
  console.log('\nHue wheel — doc 05 §2.2 reserves hue for status');
  const reserved = ['success', 'status-good', 'healing', 'status-warning', 'status-critical'];
  const wheel = [['accent', tokens['accent']], ...reserved.map((name) => [name, tokens[name]])];
  for (const [name, hex] of wheel) {
    if (!hex) continue;
    const h = hue(hex);
    const s = saturation(hex);
    console.log(
      `  ${name.padEnd(16)} ${hex}  hue ${h === null ? '  none' : `${h.toFixed(0).padStart(4)}°`}` +
        `  sat ${(s * 100).toFixed(0).padStart(3)}%`,
    );
  }

  const accentHue = hue(tokens['accent']);
  if (accentHue !== null) {
    console.log('\n  distance from the accent to each reserved hue:');
    for (const name of reserved) {
      const h = hue(tokens[name]);
      if (h === null) continue;
      const raw = Math.abs(accentHue - h);
      const distance = Math.min(raw, 360 - raw);
      console.log(`    ${name.padEnd(16)} ${distance.toFixed(0).padStart(3)}°`);
    }
  }
}

console.log(
  failed === 0
    ? '\nAll pairs pass.\n'
    : `\n${failed} pair${failed === 1 ? '' : 's'} below threshold.\n`,
);

process.exit(failed === 0 ? 0 : 1);
