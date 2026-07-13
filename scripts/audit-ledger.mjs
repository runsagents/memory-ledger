#!/usr/bin/env node

import { readdir, writeFile } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readAndValidate } from './validate-entry.mjs';

function usage() {
  return [
    'Usage: node scripts/audit-ledger.mjs [memories-dir] [options]',
    '',
    'Options:',
    '  --as-of YYYY-MM-DD       Audit date (default: today in UTC)',
    '  --scope global           Allow only global entries',
    '  --scope project:REF      Allow global entries and project entries for REF',
    '  --output FILE            Also write the Markdown report to FILE',
    '  --help                   Show this help'
  ].join('\n');
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function parseArguments(args) {
  const options = {
    directory: 'memories',
    asOf: new Date().toISOString().slice(0, 10),
    scope: null,
    output: null
  };
  let directorySet = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help') return { help: true };
    if (['--as-of', '--scope', '--output'].includes(arg)) {
      const value = args[++index];
      if (!value) throw new Error(`${arg} requires a value`);
      if (arg === '--as-of') options.asOf = value;
      if (arg === '--scope') options.scope = value;
      if (arg === '--output') options.output = value;
    } else if (arg.startsWith('-')) {
      throw new Error(`unknown option: ${arg}`);
    } else if (!directorySet) {
      options.directory = arg;
      directorySet = true;
    } else {
      throw new Error(`unexpected argument: ${arg}`);
    }
  }
  if (!validDate(options.asOf)) throw new Error('--as-of must be a real date in YYYY-MM-DD form');
  if (options.scope && options.scope !== 'global' && !options.scope.startsWith('project:')) {
    throw new Error('--scope must be `global` or `project:REF`');
  }
  if (options.scope?.startsWith('project:') && options.scope.slice(8).trim() === '') {
    throw new Error('--scope project reference cannot be empty');
  }
  return options;
}

async function markdownFiles(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const paths = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) paths.push(...await markdownFiles(root, path));
    else if (entry.isFile() && entry.name.endsWith('.md')) paths.push(path);
  }
  return paths;
}

function scopeViolation(data, context) {
  if (!context || !data?.scope) return null;
  if (context === 'global' && data.scope.level === 'project') {
    return `project-scoped entry cannot be trusted in global context`;
  }
  if (context.startsWith('project:') && data.scope.level === 'project') {
    const expected = context.slice(8);
    if (data.scope.reference !== expected) {
      return `scope is \`${data.scope.reference}\`, audit context is \`${expected}\``;
    }
  }
  return null;
}

function resolveTarget(entry, byId, byBasename) {
  const target = entry.data?.['superseded-by'];
  if (!target) return null;
  return byId.get(target) ?? byBasename.get(target) ?? null;
}

function supersessionChain(start, byId, byBasename) {
  const chain = [start];
  const seen = new Set([start.id]);
  let current = start;
  while (current.data?.['superseded-by']) {
    const targetName = current.data['superseded-by'];
    const next = resolveTarget(current, byId, byBasename);
    if (!next) return { chain, broken: `target \`${targetName}\` does not exist` };
    chain.push(next);
    if (seen.has(next.id)) return { chain, broken: `cycle returns to \`${next.id}\`` };
    seen.add(next.id);
    current = next;
  }
  return { chain, broken: null };
}

function bulletOrNone(items) {
  return items.length ? items.map((item) => `- ${item}`).join('\n') : '- None.';
}

function reportFor(result) {
  const {
    directory, asOf, context, entries, invalid, expired, overdue, missingSources,
    scopeViolations, superseded, supersessionChains, brokenChains, actionEligible
  } = result;
  const blocking = invalid.length + expired.length + overdue.length + missingSources.length + scopeViolations.length + brokenChains.length;
  const lines = [
    '# Memory ledger audit',
    '',
    `- Directory: \`${directory}\``,
    `- As of: \`${asOf}\``,
    `- Trust context: ${context ? `\`${context}\`` : 'not supplied (structural scope checks only)'}`,
    `- Result: **${blocking === 0 ? 'PASS' : 'REVIEW REQUIRED'}**`,
    '',
    '## Summary',
    '',
    '| Check | Count |',
    '| --- | ---: |',
    `| Entries scanned | ${entries.length} |`,
    `| Invalid entries | ${invalid.length} |`,
    `| Expired entries | ${expired.length} |`,
    `| Review overdue | ${overdue.length} |`,
    `| Missing sources | ${missingSources.length} |`,
    `| Scope violations | ${scopeViolations.length} |`,
    `| Superseded entries | ${superseded.length} |`,
    `| Broken supersession chains | ${brokenChains.length} |`,
    `| Action-eligible entries | ${actionEligible.length} |`,
    '',
    '## Invalid entries',
    '',
    bulletOrNone(invalid.map(({ id, errors }) => `\`${id}\`: ${errors.join('; ')}`)),
    '',
    '## Expired or overdue',
    '',
    bulletOrNone([
      ...expired.map(({ id, date }) => `\`${id}\` expired after \`${date}\`; do not trust it or let it authorize action.`),
      ...overdue.map(({ id, date }) => `\`${id}\` was due for review after \`${date}\`; re-verify before trusting it.`)
    ]),
    '',
    '## Missing sources',
    '',
    bulletOrNone(missingSources.map(({ id }) => `\`${id}\` has no concrete, retrievable source reference.`)),
    '',
    '## Scope violations',
    '',
    bulletOrNone(scopeViolations.map(({ id, reason }) => `\`${id}\`: ${reason}.`)),
    '',
    '## Supersession chains',
    '',
    bulletOrNone(supersessionChains.map(({ chain }) => chain.map(({ id }) => `\`${id}\``).join(' → '))),
    '',
    '## Broken supersession chains',
    '',
    bulletOrNone(brokenChains.map(({ id, reason }) => `\`${id}\`: ${reason}.`)),
    '',
    '## Action-authorizing review',
    '',
    actionEligible.length
      ? actionEligible.map(({ id }) => `- \`${id}\` is structurally eligible, current, and in scope. Re-read its source before acting; the flag is not standing permission.`).join('\n')
      : '- No current, in-scope entry is eligible to authorize action.',
    ''
  ];
  return { markdown: lines.join('\n'), blocking };
}

export async function auditLedger(options) {
  const root = resolve(options.directory);
  const paths = await markdownFiles(root);
  const entries = [];
  for (const path of paths) {
    const checked = await readAndValidate(path);
    entries.push({ id: relative(root, path).replaceAll('\\', '/'), path, ...checked });
  }
  const invalid = entries.filter((entry) => entry.errors.length > 0);
  const valid = entries.filter((entry) => entry.errors.length === 0);
  const missingSources = entries.filter((entry) =>
    entry.errors.some((error) => error.includes('source.reference') || error.startsWith('`source`'))
  );
  const expired = valid
    .filter((entry) => entry.data.expires && options.asOf > entry.data.expires)
    .map((entry) => ({ id: entry.id, date: entry.data.expires }));
  const overdue = valid
    .filter((entry) => entry.data['review-by'] && options.asOf > entry.data['review-by'])
    .map((entry) => ({ id: entry.id, date: entry.data['review-by'] }));
  const structuralScopeViolations = invalid
    .filter((entry) => entry.errors.some((error) => error.includes('scope')))
    .map((entry) => ({ id: entry.id, reason: 'scope declaration is invalid' }));
  const contextualScopeViolations = valid
    .map((entry) => ({ id: entry.id, reason: scopeViolation(entry.data, options.scope) }))
    .filter((item) => item.reason);
  const scopeViolations = [...structuralScopeViolations, ...contextualScopeViolations];

  const byId = new Map(valid.map((entry) => [entry.id, entry]));
  const byBasename = new Map();
  for (const entry of valid) {
    const name = basename(entry.id);
    byBasename.set(name, byBasename.has(name) ? null : entry);
  }
  const superseded = valid.filter((candidate) => candidate.data['superseded-by']);
  const targetedIds = new Set(superseded.map((entry) => resolveTarget(entry, byId, byBasename)?.id).filter(Boolean));
  const roots = superseded.filter((entry) => !targetedIds.has(entry.id));
  const supersessionChains = [];
  const brokenChains = [];
  const visited = new Set();
  for (const entry of [...roots, ...superseded]) {
    if (visited.has(entry.id)) continue;
    const result = supersessionChain(entry, byId, byBasename);
    supersessionChains.push(result);
    for (const member of result.chain.filter((candidate) => candidate.data['superseded-by'])) visited.add(member.id);
    if (result.broken) brokenChains.push({ id: entry.id, reason: result.broken });
  }

  const blockedIds = new Set([
    ...expired.map((item) => item.id),
    ...overdue.map((item) => item.id),
    ...scopeViolations.map((item) => item.id),
    ...superseded.map((entry) => entry.id)
  ]);
  const actionEligible = valid.filter((entry) =>
    entry.data['may-this-authorize-action'] === true && !blockedIds.has(entry.id)
  );

  return {
    directory: options.directory,
    asOf: options.asOf,
    context: options.scope,
    entries,
    invalid,
    expired,
    overdue,
    missingSources,
    scopeViolations,
    superseded,
    supersessionChains,
    brokenChains,
    actionEligible
  };
}

async function main(args) {
  let options;
  try {
    options = parseArguments(args);
  } catch (error) {
    console.error(`Error: ${error.message}\n\n${usage()}`);
    return 2;
  }
  if (options.help) {
    console.log(usage());
    return 0;
  }
  try {
    const result = await auditLedger(options);
    const report = reportFor(result);
    console.log(report.markdown);
    if (options.output) await writeFile(options.output, report.markdown, 'utf8');
    return report.blocking === 0 ? 0 : 1;
  } catch (error) {
    console.error(`Error: ${error.message}`);
    return 2;
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
