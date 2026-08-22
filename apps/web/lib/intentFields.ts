/**
 * The fields a plain-English description appears to be asking for.
 *
 * This is what the create form shows back to someone while they type — "you are asking for product
 * name, price and stock" — so the contract is not a surprise the first time a run is scored against
 * it. Doc 03 §1.1: the description *becomes* the contract, and a form that takes a sentence and
 * shows nothing back is asking for a guess.
 *
 * **It is a preview, not the contract.** The real field list is inferred by the model when the
 * collector is created, and it will sometimes differ from this: this reads punctuation, the model
 * reads meaning. Every place that renders the output says "detected" for that reason, and nothing
 * downstream depends on it. A heuristic presented as a heuristic is useful; the same heuristic
 * presented as the answer is a lie that surfaces two minutes later.
 *
 * Kept deliberately dumb — split on the separators people actually type, strip the words that
 * introduce a list, and stop. A cleverer parser would be wrong in more interesting ways, and the
 * model behind the real inference is the right place for cleverness.
 */

/** Verbs and openers that introduce a list rather than belonging to it. */
const OPENERS =
  /^\s*(?:i\s+(?:want|need)\s+(?:to\s+)?|please\s+|can\s+you\s+|give\s+me\s+|show\s+me\s+|just\s+|only\s+)*(?:get|grab|extract|collect|scrape|pull|fetch|capture|track|monitor|find|list)?\s*(?:me\s+)?(?:the\s+|all\s+(?:the\s+)?|every\s+|each\s+)?/i;

/** Everything from here on describes *where*, not *what*. */
const LOCATION = /\s+(?:from|on|off|out\s+of|for\s+each|for\s+every)\s+/i;

/** Trailing noise left over once the list is split. */
const TRAILING = /^(?:and|&|plus|also|its|their|the)\s+/i;

/** Politeness at the end of a sentence is not a field. */
const PLEASANTRY = /\s+(?:please|thanks|thank\s+you)$/i;

const MAX_FIELDS = 8;
const MAX_FIELD_LENGTH = 40;

export function detectFields(intent: string): string[] {
  const [subject = ''] = intent.split(LOCATION);

  const list = subject.replace(OPENERS, '');
  const seen = new Set<string>();
  const fields: string[] = [];

  for (const part of list.split(/\s*(?:,|;|\/|\band\b|&|\bplus\b)\s*/i)) {
    const field = part
      .replace(TRAILING, '')
      .replace(/[.!?]+$/, '')
      .replace(PLEASANTRY, '')
      .trim()
      .toLowerCase();

    // A "field" of forty characters is a sentence that happened to contain no comma, and showing it
    // back as a chip would look like the parser had understood something it plainly has not.
    if (field === '' || field.length > MAX_FIELD_LENGTH) continue;
    if (seen.has(field)) continue;

    seen.add(field);
    fields.push(field);
    if (fields.length === MAX_FIELDS) break;
  }

  return fields;
}
