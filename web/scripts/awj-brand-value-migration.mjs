#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const files = args.filter((arg) => arg !== '--check');

if (files.length === 0) {
  console.error('Usage: node scripts/awj-brand-value-migration.mjs [--check] <json-file> [...]');
  process.exit(1);
}

const PRESERVED_VALUES = [
  'nibras-api-e6e9.onrender.com',
  'nebrax.vercel.app',
  'نبراس الطموح',
];

const REPLACEMENTS = [
  ['NEBRAX', 'AWJ'],
  ['Nebrax', 'AWJ'],
  ['NIBRAS', 'AWJ'],
  ['Nibras', 'AWJ'],
  ['نبراكس', 'أَوْج'],
  ['نبراس', 'أَوْج'],
];

function migrateString(value) {
  const preserved = [];
  let next = value;

  for (const literal of PRESERVED_VALUES) {
    if (!next.includes(literal)) continue;
    const placeholder = `__AWJ_PRESERVE_${preserved.length}__`;
    preserved.push([placeholder, literal]);
    next = next.replaceAll(literal, placeholder);
  }

  for (const [legacy, canonical] of REPLACEMENTS) {
    next = next.replaceAll(legacy, canonical);
  }

  for (const [placeholder, literal] of preserved) {
    next = next.replaceAll(placeholder, literal);
  }

  return next;
}

function migrateValue(value) {
  if (typeof value === 'string') return migrateString(value);
  if (Array.isArray(value)) return value.map(migrateValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, migrateValue(child)]),
    );
  }
  return value;
}

let changedFiles = 0;

for (const file of files) {
  const absolute = path.resolve(process.cwd(), file);
  const source = fs.readFileSync(absolute, 'utf8');
  const parsed = JSON.parse(source);
  const migrated = migrateValue(parsed);
  const output = `${JSON.stringify(migrated, null, 2)}\n`;

  if (output === source) {
    console.log(`Already clean: ${file}`);
    continue;
  }

  changedFiles += 1;
  if (checkOnly) {
    console.error(`Legacy customer-facing brand values remain in ${file}`);
    continue;
  }

  // JSON object keys are intentionally preserved; only string values are migrated.
  fs.writeFileSync(absolute, output, 'utf8');
  console.log(`Migrated customer-facing AWJ values in ${file}`);
}

if (checkOnly && changedFiles > 0) process.exit(2);
