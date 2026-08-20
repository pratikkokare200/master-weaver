/**
 * The diagnosis builder — doc 01 §5.
 *
 * `scraper heal` takes one plain-language problem description, capped at 1000 characters, and the
 * quality of that string decides whether the repair works. Generating a good one automatically, from
 * evidence, is what doc 01 calls "the core intellectual property of this project".
 *
 * Three things make a description work, and all three are structural rather than stylistic:
 *
 *   1. **Before and after, per field.** "price stopped working" is a complaint. "price was 95%
 *      filled and returned 1299.00, now 30% filled and returns an empty string" is a specification.
 *   2. **Naming the healthy fields.** Unconstrained healing has a habit of "fixing" fields that were
 *      never broken. Pinning them is free insurance, and doc 01 §5.2 calls that closing line the
 *      detail a judge who has run scrapers in production will recognise immediately.
 *   3. **Page context.** The ~400 characters surrounding the last-known-good value tell the healer
 *      where the data *moved to*, which is the one thing it cannot work out from our side.
 *
 * The 1000-character budget is spent deliberately. When the description is too long, page context is
 * truncated first and the before/after examples last, because the examples are the part the healer
 * cannot reconstruct. The closing instruction is never truncated at all.
 */

import { CLI_INPUT_LIMITS } from '@weaver/contracts';
import type { CollectorContract, FhsBreakdown, FieldType, ScrapedRow } from '@weaver/contracts';
import { extractFieldValue, isFilled } from '@weaver/validation';

/** Everything known about one broken field, in the order the description will spend it. */
export interface FieldEvidence {
  name: string;
  type: FieldType;
  /** Fill rate at the last healthy run, 0–1. `null` when there is no baseline to compare against. */
  fillBefore: number | null;
  /** Fill rate now, 0–1. */
  fillAfter: number;
  /** A value this field used to return, rendered for the prompt. */
  goodExample: string | null;
  /** What it returns instead, rendered for the prompt. */
  badExample: string;
}

/** The assembled evidence bundle — doc 01 §5.1. */
export interface EvidenceBundle {
  /** Broken fields, worst first. */
  failedFields: FieldEvidence[];
  /** Names of fields still working. Sent so the healer is told not to touch them. */
  healthyFields: string[];
  /** ~400 characters of page markdown around where the worst field's value used to be. */
  pageContext?: string | null;
}

/** How many broken fields the description enumerates. Doc 01 §5.2: "up to 3 worst fields". */
export const MAX_REPORTED_FIELDS = 3;

/** Characters of page context requested before truncation. Doc 01 §5.1. */
export const PAGE_CONTEXT_CHARS = 400;

const MAX_CHARS = CLI_INPUT_LIMITS.DIAGNOSIS_CHARS;

/** The line that stops the healer rewriting fields that were never broken. Never truncated. */
const CLOSING =
  'Please update the extraction logic for the broken field(s) only. ' +
  'Do not change the fields that still work.';

/** Render a scraped value for a prompt: short, unambiguous, and obviously a value rather than prose. */
export function renderExample(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return value.trim() === '' ? 'an empty string' : JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  const json = JSON.stringify(value);
  if (json === undefined) return 'an unreadable value';
  return json.length > 80 ? `${json.slice(0, 77)}...` : json;
}

function percent(rate: number | null): string {
  return rate === null ? 'unknown' : `${Math.round(rate * 100)}%`;
}

/**
 * Inline binary and encoded junk, stripped from page markdown before anything looks at it.
 *
 * Ordered deliberately — the markdown-image rule must run before the bare `data:` rule, or the
 * image's `![alt](...)` wrapper is left behind as debris once its target is removed.
 *
 * On why `[^)]*` is safe for a data URI: the payload is percent-encoded, so a literal `)` inside it
 * would be `%29`. It cannot terminate the match early. Matching to the closing paren is what makes
 * this work at all — an SVG data URI contains spaces and quotes, so the obvious `[^\s)"']*` stops a
 * few characters in and leaves the whole body behind. That was the first version of this, and it
 * removed 300 characters of a 7,788-character page while reporting success.
 */
const NOISE_PATTERNS: readonly RegExp[] = [
  /!\[[^\]]*\]\(\s*data:[^)]*\)/gi, // markdown image whose target is a data URI
  /\bdata:[a-z0-9.+-]+\/[a-z0-9.+-]+[;,][^)\s]*\)?/gi, // a bare data URI
  /<svg\b[^>]*>[\s\S]*?<\/svg>/gi, // inline SVG markup
  /(?:%[0-9A-Fa-f]{2}){8,}/g, // long percent-encoded runs — encoded markup, not prose
  /\b[A-Za-z0-9+/]{80,}={0,2}\b/g, // long base64 blobs
];

/**
 * Strip inline binary junk from scraped markdown.
 *
 * The Chaos Lab renders each product's placeholder image as an inline SVG data URI, and the first
 * real healing episode showed why that matters far more than the wasted characters.
 *
 * **The anchor was matching inside the junk.** Those SVGs carry the product name as rendered label
 * text — `%3EAeroBook Pro 14%3C/text%3E` — so `indexOf('AeroBook Pro 14')` found the copy buried in
 * the image payload rather than the copy in the catalogue. The 400-character window then centred on
 * base64-adjacent gibberish, and the healer was sent `rx='2' fill='%230f172a'/%3E%3Cpolygon
 * points='20,126 220,126...` as its description of where the data went. The genuinely useful line —
 * `AeroBook Pro 14 16GB 512GB 1299USD Available` — was three words from the centre and got about a
 * third of the budget.
 *
 * So this runs before the anchor search, not just before the slice. Cleaning only the output would
 * have kept the prompt tidy while still pointing it at the wrong part of the page.
 *
 * Conservative on purpose. It removes things that are definitionally not prose — data URIs, inline
 * SVG, long percent-encoded and base64 runs — and leaves everything else alone. Over-stripping here
 * costs more than under-stripping: page context is the one part of a diagnosis we cannot regenerate
 * from our own records, so deleting real content to save characters trades the valuable thing for
 * the cheap one.
 */
export function stripBinaryNoise(markdown: string): string {
  let out = markdown;
  for (const pattern of NOISE_PATTERNS) out = out.replace(pattern, ' ');
  return out;
}

/**
 * Pull the ~400 characters surrounding a known value out of the page's markdown.
 *
 * This is the single most valuable part of the prompt and the first part sacrificed to the character
 * budget — valuable because it shows where the data went, sacrificable because a healer with the
 * before/after examples can still search the page itself.
 *
 * Falls back to the head of the document when the anchor is gone, which is the common case: the
 * value usually *has* moved, and the top of the page is a better hint than nothing.
 */
export function extractPageContext(
  markdown: string | null | undefined,
  anchor: string | null | undefined,
  radius: number = PAGE_CONTEXT_CHARS,
): string | null {
  if (!markdown || markdown.trim() === '') return null;

  // Before the anchor search, not merely before the slice — see stripBinaryNoise.
  const clean = collapse(stripBinaryNoise(markdown));
  if (clean === '') return null;

  const half = Math.max(1, Math.floor(radius / 2));
  const index = anchor && anchor.trim() !== '' ? clean.indexOf(anchor) : -1;

  if (index === -1) return clean.slice(0, radius).trim();

  const start = Math.max(0, index - half);
  return clean.slice(start, start + radius).trim();
}

/** Whitespace in scraped markdown is noise that costs characters we have a hard budget for. */
function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Assemble the evidence bundle from two scores and two sample rows.
 *
 * `before` is the last healthy run's breakdown and may be null on a collector whose very first run
 * broke — the description then reports the current state without a comparison, which is weaker but
 * still actionable, and is strictly better than refusing to heal for want of history.
 */
export function buildEvidence(input: {
  after: FhsBreakdown;
  before?: FhsBreakdown | null;
  contract: CollectorContract;
  goodRow?: ScrapedRow | null;
  badRow?: ScrapedRow | null;
  pageMarkdown?: string | null;
}): EvidenceBundle {
  const { after, before, contract, goodRow, badRow } = input;

  const beforeByField = new Map((before?.field_scores ?? []).map((f) => [f.field, f]));
  const contractByField = new Map((contract.fields ?? []).map((f) => [f.name, f]));

  const failed: FieldEvidence[] = [];
  const healthy: string[] = [];

  for (const score of after.field_scores) {
    const field = contractByField.get(score.field);
    if (!field) continue;

    if (!score.below_min_fill) {
      healthy.push(score.field);
      continue;
    }

    const good = goodRow ? extractFieldValue(goodRow, field) : undefined;
    const bad = badRow ? extractFieldValue(badRow, field) : undefined;

    failed.push({
      name: score.field,
      type: field.type,
      fillBefore: beforeByField.get(score.field)?.fill_rate ?? null,
      fillAfter: score.fill_rate,
      goodExample: isFilled(good) ? renderExample(good) : null,
      badExample: isFilled(bad) ? renderExample(bad) : 'nothing',
    });
  }

  // Worst first: the field that lost the most fill is the one worth the character budget. Ties go to
  // the lower current fill, so a field at 0% outranks one at 40% that fell from the same height.
  failed.sort((a, b) => {
    const dropA = (a.fillBefore ?? 1) - a.fillAfter;
    const dropB = (b.fillBefore ?? 1) - b.fillAfter;
    return dropB - dropA || a.fillAfter - b.fillAfter;
  });

  const worst = failed[0];
  const anchor = worst?.goodExample ? stripQuotes(worst.goodExample) : null;

  return {
    failedFields: failed,
    healthyFields: healthy,
    pageContext: extractPageContext(input.pageMarkdown, anchor),
  };
}

function stripQuotes(rendered: string): string {
  return rendered.startsWith('"') && rendered.endsWith('"') ? rendered.slice(1, -1) : rendered;
}

/**
 * Build the description sent to `scraper heal` — doc 01 §5.2's template.
 *
 * Guaranteed to come back at or under {@link CLI_INPUT_LIMITS.DIAGNOSIS_CHARS}. The CLI rejects a
 * longer one outright, and discovering that at the heal call means an episode that spent its
 * detection work and produced nothing.
 */
export function buildDiagnosis(bundle: EvidenceBundle, maxChars: number = MAX_CHARS): string {
  const reported = bundle.failedFields.slice(0, MAX_REPORTED_FIELDS);

  const header =
    `The scraper stopped extracting ${bundle.failedFields.length} field(s) after a site layout change.`;

  const brokenBlocks = reported.map((f) => {
    const fill = `${f.name}: was ${percent(f.fillBefore)} filled, now ${percent(f.fillAfter)}.`;
    const example =
      f.goodExample !== null
        ? ` Previously returned ${f.goodExample}, now returns ${f.badExample}.`
        : ` Now returns ${f.badExample}.`;
    return `BROKEN: ${fill}${example}`;
  });

  const stillWorking =
    bundle.healthyFields.length > 0 ? `STILL WORKING: ${bundle.healthyFields.join(', ')}` : null;

  const assemble = (context: string | null, blocks: string[]): string =>
    [
      header,
      '',
      ...blocks,
      '',
      stillWorking,
      context ? '' : null,
      context ? `The value now appears on the page near this content:\n${context}` : null,
      '',
      CLOSING,
    ]
      .filter((line) => line !== null)
      .join('\n')
      .trim();

  // Full version first.
  let out = assemble(bundle.pageContext ?? null, brokenBlocks);
  if (out.length <= maxChars) return out;

  // 1. Truncate the page context — it is the largest and most compressible piece.
  if (bundle.pageContext) {
    const overflow = out.length - maxChars;
    const trimmed = bundle.pageContext.length - overflow - 1;
    const shorter = trimmed > 40 ? `${bundle.pageContext.slice(0, trimmed)}…` : null;
    out = assemble(shorter, brokenBlocks);
    if (out.length <= maxChars) return out;
  }

  // 2. Drop broken-field blocks from the end — the worst field is first, so the most informative
  //    example is the last thing to go.
  for (let keep = brokenBlocks.length - 1; keep >= 1; keep -= 1) {
    out = assemble(null, brokenBlocks.slice(0, keep));
    if (out.length <= maxChars) return out;
  }

  // 3. Last resort: hard cut, preserving the closing instruction, which is the one line whose
  //    absence actively causes damage rather than merely losing information.
  const room = maxChars - CLOSING.length - 2;
  return `${out.slice(0, Math.max(0, room)).trim()}\n\n${CLOSING}`.slice(0, maxChars);
}

/** Why the previous attempt was rejected, in the terms the next attempt needs. */
export interface RejectionContext {
  field: string;
  /** What the canary actually returned for that field. */
  observed: string;
  /** What the contract declares it should be. */
  expectedType: FieldType | string;
}

/**
 * Refine a description after a rejection — doc 01 §5.3.
 *
 * "Do not resend the same description." A healer given identical input has no reason to produce a
 * different template, so an unrefined retry spends credits to reproduce the fix we just rejected.
 *
 * The note is appended rather than prepended: the evidence is what the healer acts on, and the
 * correction is a constraint on it.
 */
export function refineDiagnosis(
  previous: string,
  rejection: RejectionContext,
  maxChars: number = MAX_CHARS,
): string {
  const note =
    `A previous fix attempt was rejected because ${rejection.field} still returned ` +
    `${rejection.observed} instead of a ${rejection.expectedType}. ` +
    'Try a different approach for that field.';

  const combined = `${previous.trim()}\n\n${note}`;
  if (combined.length <= maxChars) return combined;

  // The correction is newer information than the original evidence, so it wins the budget contest.
  const room = maxChars - note.length - 2;
  if (room <= 0) return note.slice(0, maxChars);
  return `${previous.trim().slice(0, room).trim()}\n\n${note}`;
}

/** Convenience: evidence to prompt in one call, for the common path. */
export function diagnose(
  input: Parameters<typeof buildEvidence>[0],
  maxChars: number = MAX_CHARS,
): { bundle: EvidenceBundle; description: string } {
  const bundle = buildEvidence(input);
  return { bundle, description: buildDiagnosis(bundle, maxChars) };
}
