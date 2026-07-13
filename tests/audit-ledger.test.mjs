import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { auditLedger } from '../scripts/audit-ledger.mjs';

const root = new URL('..', import.meta.url).pathname;
const projectScope = 'project:github.com/runsagents/memory-ledger';

function entry({ fact, source = true, scope = 'project:test', supersededBy = null }) {
  return `---
fact: "${fact}"
${source ? 'source:\n  kind: observed\n  reference: "fixture:command-output#1"\n' : ''}scope:
  level: project
  reference: "${scope}"
confidence: 1
created: "2026-07-14"
review-by: "2026-08-14"
superseded-by: ${supersededBy ? `"${supersededBy}"` : 'null'}
may-this-authorize-action: false
synthetic: true
---

> Synthetic test fixture.
`;
}

test('example audit output is reproducible and returns review-required status', async () => {
  const expected = await readFile(join(root, 'examples/audit-report.md'), 'utf8');
  const run = spawnSync(process.execPath, [
    'scripts/audit-ledger.mjs',
    'examples/memories',
    '--as-of',
    '2026-07-14',
    '--scope',
    projectScope
  ], { cwd: root, encoding: 'utf8' });

  assert.equal(run.status, 1);
  assert.equal(run.stderr, '');
  assert.equal(run.stdout, `${expected}\n`);
});

test('audit detects missing sources and use in the wrong project scope', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'memory-ledger-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'missing-source.md'), entry({ fact: 'Missing source', source: false }));
  await writeFile(join(directory, 'wrong-scope.md'), entry({ fact: 'Wrong scope', scope: 'project:other' }));

  const result = await auditLedger({
    directory,
    asOf: '2026-07-14',
    scope: 'project:expected',
    output: null
  });
  assert.equal(result.invalid.length, 1);
  assert.equal(result.missingSources.length, 1);
  assert.equal(result.scopeViolations.length, 1);
  assert.match(result.scopeViolations[0].reason, /audit context/);
});

test('audit reports a supersession cycle once and marks both entries superseded', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'memory-ledger-cycle-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'a.md'), entry({ fact: 'A', supersededBy: 'b.md' }));
  await writeFile(join(directory, 'b.md'), entry({ fact: 'B', supersededBy: 'a.md' }));

  const result = await auditLedger({
    directory,
    asOf: '2026-07-14',
    scope: 'project:project:test',
    output: null
  });
  assert.equal(result.superseded.length, 2);
  assert.equal(result.supersessionChains.length, 1);
  assert.equal(result.brokenChains.length, 1);
  assert.match(result.brokenChains[0].reason, /cycle/);
});

test('an empty, well-formed ledger passes all audit checks', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'memory-ledger-empty-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const result = await auditLedger({
    directory,
    asOf: '2026-07-14',
    scope: 'global',
    output: null
  });
  assert.equal(result.entries.length, 0);
  assert.equal(result.invalid.length, 0);
  assert.equal(result.brokenChains.length, 0);
});
