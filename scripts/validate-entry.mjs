#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TOP_LEVEL_FIELDS = new Set([
  'fact',
  'source',
  'scope',
  'confidence',
  'created',
  'expires',
  'review-by',
  'superseded-by',
  'may-this-authorize-action',
  'synthetic'
]);
const SOURCE_FIELDS = new Set(['kind', 'reference']);
const SCOPE_FIELDS = new Set(['level', 'reference']);
const PLACEHOLDER = /^(?:todo|tbd|unknown|none|n\/a|replace\b|example\b|<.*>|\{\{.*\}\})/i;

function scalar(value, lineNumber) {
  const trimmed = value.trim();
  if (trimmed === 'null' || trimmed === '~') return null;
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed.startsWith('"')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed !== 'string') throw new Error('not a string');
      return parsed;
    } catch {
      throw new Error(`line ${lineNumber}: invalid double-quoted string`);
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  if (!trimmed || /[\[\]{}&*!|>]/.test(trimmed)) {
    throw new Error(`line ${lineNumber}: unsupported YAML scalar; use a quoted string`);
  }
  return trimmed.replace(/\s+#.*$/, '').trim();
}

export function parseEntry(text) {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  if (lines[0] !== '---') throw new Error('entry must start with YAML frontmatter (`---`)');
  const close = lines.indexOf('---', 1);
  if (close === -1) throw new Error('entry frontmatter is missing its closing `---`');

  const data = {};
  let parent = null;
  for (let index = 1; index < close; index += 1) {
    const raw = lines[index];
    const lineNumber = index + 1;
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue;
    if (/\t/.test(raw)) throw new Error(`line ${lineNumber}: tabs are not supported`);
    const match = /^( *)([a-z][a-z0-9-]*):(?:\s*(.*))?$/.exec(raw);
    if (!match) throw new Error(`line ${lineNumber}: expected \`key: value\``);
    const indent = match[1].length;
    const key = match[2];
    const value = match[3] ?? '';

    if (indent === 0) {
      if (Object.hasOwn(data, key)) throw new Error(`line ${lineNumber}: duplicate field \`${key}\``);
      if (!value.trim()) {
        data[key] = {};
        parent = key;
      } else {
        data[key] = scalar(value, lineNumber);
        parent = null;
      }
    } else if (indent === 2 && parent) {
      if (Object.hasOwn(data[parent], key)) {
        throw new Error(`line ${lineNumber}: duplicate field \`${parent}.${key}\``);
      }
      if (!value.trim()) throw new Error(`line ${lineNumber}: nested objects are only one level deep`);
      data[parent][key] = scalar(value, lineNumber);
    } else {
      throw new Error(`line ${lineNumber}: only two-space, one-level nesting is supported`);
    }
  }

  return { data, body: lines.slice(close + 1).join('\n') };
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function dateIsValid(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function concreteReference(value) {
  return typeof value === 'string' && value.trim().length > 0 && !PLACEHOLDER.test(value.trim());
}

export function validateEntry(data) {
  const errors = [];
  if (!isObject(data)) return ['frontmatter must contain an object'];

  for (const key of Object.keys(data)) {
    if (!TOP_LEVEL_FIELDS.has(key)) errors.push(`unknown field \`${key}\``);
  }
  if (typeof data.fact !== 'string' || !data.fact.trim()) errors.push('`fact` must be a non-empty string');

  if (!isObject(data.source)) {
    errors.push('`source` must contain `kind` and `reference`');
  } else {
    for (const key of Object.keys(data.source)) {
      if (!SOURCE_FIELDS.has(key)) errors.push(`unknown field \`source.${key}\``);
    }
    if (!['user-said', 'observed', 'inferred'].includes(data.source.kind)) {
      errors.push('`source.kind` must be `user-said`, `observed`, or `inferred`');
    }
    if (!concreteReference(data.source.reference)) {
      errors.push('`source.reference` must be a concrete, retrievable reference (not a placeholder)');
    }
  }

  if (!isObject(data.scope)) {
    errors.push('`scope` must contain `level` and, for project scope, `reference`');
  } else {
    for (const key of Object.keys(data.scope)) {
      if (!SCOPE_FIELDS.has(key)) errors.push(`unknown field \`scope.${key}\``);
    }
    if (!['project', 'global'].includes(data.scope.level)) {
      errors.push('`scope.level` must be `project` or `global`');
    } else if (data.scope.level === 'project' && !concreteReference(data.scope.reference)) {
      errors.push('project scope requires a concrete `scope.reference`');
    } else if (data.scope.level === 'global' && Object.hasOwn(data.scope, 'reference')) {
      errors.push('global scope must not include `scope.reference`');
    }
  }

  if (typeof data.confidence !== 'number' || !Number.isFinite(data.confidence) || data.confidence < 0 || data.confidence > 1) {
    errors.push('`confidence` must be a number from 0 to 1');
  }
  if (!dateIsValid(data.created)) errors.push('`created` must be a real date in YYYY-MM-DD form');

  const hasExpires = Object.hasOwn(data, 'expires');
  const hasReview = Object.hasOwn(data, 'review-by');
  if (hasExpires === hasReview) errors.push('include exactly one of `expires` or `review-by`');
  if (hasExpires && !dateIsValid(data.expires)) errors.push('`expires` must be a real date in YYYY-MM-DD form');
  if (hasReview && !dateIsValid(data['review-by'])) errors.push('`review-by` must be a real date in YYYY-MM-DD form');
  const horizon = hasExpires ? data.expires : data['review-by'];
  if (dateIsValid(data.created) && dateIsValid(horizon) && horizon < data.created) {
    errors.push('expiry/review date must not be earlier than `created`');
  }

  if (Object.hasOwn(data, 'superseded-by') && data['superseded-by'] !== null) {
    if (typeof data['superseded-by'] !== 'string' || !data['superseded-by'].trim() || /[/\\]/.test(data['superseded-by'])) {
      errors.push('`superseded-by` must be null or a filename in the same ledger directory');
    }
  }
  if (typeof data['may-this-authorize-action'] !== 'boolean') {
    errors.push('`may-this-authorize-action` must be a boolean');
  }
  if (Object.hasOwn(data, 'synthetic') && typeof data.synthetic !== 'boolean') {
    errors.push('`synthetic` must be a boolean when present');
  }

  if (data['may-this-authorize-action'] === true) {
    if (!['user-said', 'observed'].includes(data.source?.kind)) {
      errors.push('action-authorizing memory cannot have an inferred source');
    }
    if (typeof data.confidence !== 'number' || data.confidence < 0.9) {
      errors.push('action-authorizing memory requires confidence >= 0.9');
    }
    if (data.scope?.level !== 'project') {
      errors.push('action-authorizing memory must be project-scoped');
    }
    if (!hasExpires || hasReview) {
      errors.push('action-authorizing memory requires an explicit `expires` date, not `review-by`');
    }
  }

  return errors;
}

export async function readAndValidate(path) {
  try {
    const parsed = parseEntry(await readFile(path, 'utf8'));
    return { ...parsed, errors: validateEntry(parsed.data) };
  } catch (error) {
    return { data: null, body: '', errors: [error.message] };
  }
}

async function main(args) {
  if (args.length === 0 || args.includes('--help')) {
    console.log('Usage: node scripts/validate-entry.mjs <entry.md> [entry.md ...]');
    return args.includes('--help') ? 0 : 2;
  }
  let failed = false;
  for (const path of args) {
    const result = await readAndValidate(path);
    if (result.errors.length === 0) {
      console.log(`✓ ${path}\n  valid memory entry`);
    } else {
      failed = true;
      console.log(`✗ ${path}`);
      for (const error of result.errors) console.log(`  - ${error}`);
    }
  }
  return failed ? 1 : 0;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
