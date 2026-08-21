import assert from 'node:assert/strict';
import test from 'node:test';

import { parseAnswer, systemPrompt } from '../dist/prompt.js';

test('the prompt binds the collector rather than naming it in SQL', () => {
  const prompt = systemPrompt({ collectorName: 'marketplace-listings' });
  assert.match(prompt, /marketplace-listings/);
  assert.match(prompt, /where collector_id = \$1/);
  // The name appears so the model can talk about it — not so it can filter on it. A question that
  // mentions another collector must not be able to widen the query past the page being viewed.
  assert.match(prompt, /never a literal uuid and never/);
});

test('a clean JSON reply is read', () => {
  const parsed = parseAnswer('{"sql":"select 1","explanation":"counts things"}');
  assert.equal(parsed.sql, 'select 1');
  assert.equal(parsed.explanation, 'counts things');
  assert.equal(parsed.cannotAnswer, false);
});

test('a fenced reply is read — models add fences whatever they are told', () => {
  const parsed = parseAnswer('```json\n{"sql":"select 2","explanation":"x"}\n```');
  assert.equal(parsed.sql, 'select 2');
});

test('a bare query with no JSON around it is still usable', () => {
  assert.equal(parseAnswer('select * from runs').sql, 'select * from runs');
  assert.equal(parseAnswer('```sql\nselect 3\n```').sql, 'select 3');
});

test('CANNOT_ANSWER is a normal outcome, not a parse failure', () => {
  const parsed = parseAnswer('{"sql":"CANNOT_ANSWER","explanation":"no weather data here"}');
  assert.equal(parsed.sql, null);
  assert.equal(parsed.cannotAnswer, true);
  assert.equal(parsed.explanation, 'no weather data here');
});

test('prose with no query in it yields no query rather than a wrong one', () => {
  const parsed = parseAnswer('I think you should look at the runs table.');
  assert.equal(parsed.sql, null);
  assert.equal(parsed.cannotAnswer, false);
});
