import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { parseEntry, readAndValidate, validateEntry } from '../scripts/validate-entry.mjs';

const root = new URL('..', import.meta.url).pathname;

test('the published JSON Schema is valid JSON with the expected contract', async () => {
  const schema = JSON.parse(await readFile(join(root, 'schemas/memory-entry.schema.json'), 'utf8'));
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert(schema.required.includes('may-this-authorize-action'));
  assert.equal(schema.properties.source.properties.kind.enum.length, 3);
});

test('all four synthetic examples are structurally valid', async () => {
  for (const name of [
    '01-response-style.md',
    '02-expired-release-approval.md',
    '03-old-test-command.md',
    '04-current-test-command.md'
  ]) {
    const result = await readAndValidate(join(root, 'examples/memories', name));
    assert.deepEqual(result.errors, [], `${name}: ${result.errors.join('; ')}`);
    assert.equal(result.data.synthetic, true);
  }
});

test('action-authorizing memory requires stronger provenance', () => {
  const errors = validateEntry({
    fact: 'An inferred preference may trigger a deployment.',
    source: { kind: 'inferred', reference: 'analysis:session-7#inference-2' },
    scope: { level: 'global' },
    confidence: 0.8,
    created: '2026-07-14',
    'review-by': '2026-08-14',
    'may-this-authorize-action': true
  });
  assert(errors.includes('action-authorizing memory cannot have an inferred source'));
  assert(errors.includes('action-authorizing memory requires confidence >= 0.9'));
  assert(errors.includes('action-authorizing memory must be project-scoped'));
  assert(errors.includes('action-authorizing memory requires an explicit `expires` date, not `review-by`'));
});

test('parser rejects duplicate fields instead of silently overwriting provenance', () => {
  assert.throws(
    () => parseEntry('---\nfact: "first"\nfact: "second"\n---\n'),
    /duplicate field `fact`/
  );
});

test('placeholder references and contradictory time horizons are rejected', () => {
  const errors = validateEntry({
    fact: 'A fact',
    source: { kind: 'observed', reference: 'TODO' },
    scope: { level: 'project', reference: 'project:test' },
    confidence: 1,
    created: '2026-07-14',
    expires: '2026-08-14',
    'review-by': '2026-09-14',
    'may-this-authorize-action': false
  });
  assert(errors.some((error) => error.includes('source.reference')));
  assert(errors.includes('include exactly one of `expires` or `review-by`'));
});
