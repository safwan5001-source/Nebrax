import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import ar from '@/messages/ar.json';
import en from '@/messages/en.json';
import { COMING_SOON, OPS_NAV } from './nav';

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([key, value]) => (typeof value === 'string' ? [`${prefix}${key}`] : flatten(value, `${prefix}${key}.`)));
}

const arKeys = flatten((ar as unknown as { stationOps: Tree }).stationOps).sort();
const enKeys = flatten((en as unknown as { stationOps: Tree }).stationOps).sort();

const dir = fileURLToPath(new URL('.', import.meta.url));
const sources = readdirSync(dir)
  .filter((file) => /\.(ts|tsx)$/.test(file) && !/\.test\.tsx?$/.test(file) && !file.startsWith('__'))
  .map((file) => readFileSync(join(dir, file), 'utf8'));

describe('stationOps messages', () => {
  it('Arabic and English define exactly the same keys', () => {
    expect(arKeys).toEqual(enKeys);
    expect(arKeys.length).toBeGreaterThan(150);
  });

  it('every literal t("…") key used by the module exists', () => {
    const used = new Set<string>();
    for (const source of sources) for (const match of source.matchAll(/\bt\(\s*'([\w.]+)'/g)) used.add(match[1]);
    const known = new Set(arKeys);
    expect([...used].filter((key) => !known.has(key)).sort()).toEqual([]);
    expect(used.size).toBeGreaterThan(80);
  });

  it('every dynamic key family is fully defined', () => {
    const known = new Set(arKeys);
    const families: Array<[string, readonly string[]]> = [
      ['error', ['unauthorized', 'forbidden', 'not_found', 'offline', 'server', 'invalid_shape', 'demo']],
      ['shiftStatus', ['open', 'closed', 'approved']],
      ['assetStatus', ['active', 'inactive', 'maintenance']],
      ['blocked', ['station_inactive', 'nozzle_inactive', 'pump_missing', 'pump_inactive', 'tank_missing', 'tank_inactive', 'product_missing', 'product_inactive', 'product_tank_mismatch']],
      ['mode', ['supervisor', 'operator', 'viewer']],
      ['shifts.filter', ['all', 'open', 'closed', 'approved']],
      ['settings.lang', ['ar', 'en']],
      ['settings.themeOption', ['system', 'light', 'dark']],
      ['roles', ['owner', 'admin', 'accountant', 'cashier', 'viewer', 'employee']],
      ['profile.accessRow', ['stations', 'shifts', 'prices', 'open', 'approve']],
    ];
    const missing: string[] = [];
    for (const [family, members] of families) {
      for (const member of members) {
        const keys = family === 'error' ? [`error.${member}.title`, `error.${member}.body`] : [`${family}.${member}`];
        for (const key of keys) if (!known.has(key)) missing.push(key);
      }
    }
    for (const key of Object.values(COMING_SOON).flat()) if (!known.has(`soon.${key}`)) missing.push(`soon.${key}`);
    for (const item of OPS_NAV) if (!known.has(item.labelKey)) missing.push(item.labelKey);
    expect(missing).toEqual([]);
  });

  it('product copy names no tenant or fixed fuel grade', () => {
    const text = JSON.stringify([(ar as unknown as { stationOps: Tree }).stationOps, (en as unknown as { stationOps: Tree }).stationOps]);
    expect(text).not.toMatch(/نبراس|نبراكس|Nebras|Nebrax|diesel|ديزل|بنزين|gasoline|petrol/i);
  });
});
