#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const files = process.argv.slice(2);

if (files.length === 0) {
  console.error('Usage: node scripts/awj-brand-value-migration.mjs <json-file> [...]');
  process.exit(1);
}

const TECHNICAL_VALUES = [
  'nibras-api-e6e9.onrender.com',
  'nebrax.vercel.app',
];

const HISTORICAL_COMPANY = 'نبراس الطموح';

function migrateString(value) {
  if (TECHNICAL_VALUES.some((identifier) => value.includes(identifier))) {
    return value;
  }

  const historicalPlaceholder = '__AWJ_HISTORICAL_COMPANY__';
  let next = value.replaceAll(HISTORICAL_COMPANY, historicalPlaceholder);

  next = next
    .replaceAll('NEBRAX', 'AWJ')
    .replaceAll('Nebrax', 'AWJ')
    .replaceAll('NIBRAS', 'AWJ')
    .replaceAll('Nibras', 'AWJ')
    .replaceAll('نبراكس', 'أَوْج')
    .replaceAll('نبراس', 'أَوْج');

  return next.replaceAll(historicalPlaceholder, HISTORICAL_COMPANY);
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

for (const file of files) {
  const absolute = path.resolve(process.cwd(), file);
  const source = fs.readFileSync(absolute, 'utf8');
  const parsed = JSON.parse(source);
  const migrated = migrateValue(parsed);

  // JSON object keys are intentionally preserved; only string values are migrated.
  fs.writeFileSync(absolute, `${JSON.stringify(migrated, null, 2)}\n`, 'utf8');
  console.log(`Migrated customer-facing AWJ values in ${file}`);
}
