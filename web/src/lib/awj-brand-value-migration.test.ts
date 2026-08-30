import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const script = path.resolve(process.cwd(), 'scripts/awj-brand-value-migration.mjs');
const tempDirectories: string[] = [];

function createFixture(value: unknown) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'awj-brand-'));
  tempDirectories.push(directory);
  const file = path.join(directory, 'messages.json');
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return file;
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('AWJ translation migration CLI', () => {
  it('migrates customer-facing values without renaming object keys', () => {
    const file = createFixture({
      nebrax: 'منصة نبراكس',
      nested: { product: 'Nebrax ERP', alternate: 'Nibras ERP' },
    });

    execFileSync(process.execPath, [script, file]);

    const migrated = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(migrated).toEqual({
      nebrax: 'منصة أَوْج',
      nested: { product: 'AWJ ERP', alternate: 'AWJ ERP' },
    });
  });

  it('preserves historical company and technical identifiers inside migrated text', () => {
    const file = createFixture({
      history: 'وُلد نبراكس من داخل نبراس الطموح',
      deployment: 'Nebrax frontend: nebrax.vercel.app',
      backend: 'Nibras backend: nibras-api-e6e9.onrender.com',
    });

    execFileSync(process.execPath, [script, file]);

    const migrated = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(migrated.history).toBe('وُلد أَوْج من داخل نبراس الطموح');
    expect(migrated.deployment).toBe('AWJ frontend: nebrax.vercel.app');
    expect(migrated.backend).toBe('AWJ backend: nibras-api-e6e9.onrender.com');
  });

  it('makes --check fail before migration and pass after migration', () => {
    const file = createFixture({ title: 'Nebrax', arTitle: 'نبراكس' });

    const dirtyCheck = spawnSync(process.execPath, [script, '--check', file]);
    expect(dirtyCheck.status).toBe(2);
    expect(fs.readFileSync(file, 'utf8')).toContain('Nebrax');

    execFileSync(process.execPath, [script, file]);

    const cleanCheck = spawnSync(process.execPath, [script, '--check', file]);
    expect(cleanCheck.status).toBe(0);
  });
});
