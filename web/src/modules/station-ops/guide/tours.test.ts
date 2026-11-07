// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import ar from '@/messages/ar.json';
import en from '@/messages/en.json';
import { OPS_BASE } from '../nav';
import { TOURS, getTour, stepPermitted, tourAvailable, tourForPathname } from './tours';

type Tree = { [key: string]: string | Tree };
const guideAr = (ar as unknown as { stationOps: { guide: Tree } }).stationOps.guide;
const guideEn = (en as unknown as { stationOps: { guide: Tree } }).stationOps.guide;
const get = (tree: Tree, path: string): unknown => path.split('.').reduce<unknown>((node, key) => (node && typeof node === 'object' ? (node as Tree)[key] : undefined), tree);

const stationOps = fileURLToPath(new URL('..', import.meta.url));
const webRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const sourceText = (function collect(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return collect(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && !entry.name.startsWith('__') && !path.includes('/guide/') ? [readFileSync(path, 'utf8')] : [];
  });
})(stationOps).join('\n');

describe('Smart Guide tour definitions', () => {
  it('defines the five tours the app really supports; only the welcome tour starts automatically', () => {
    expect(TOURS.map((tour) => tour.id)).toEqual(['welcome', 'shifts', 'sales', 'collection', 'stock']);
    expect(TOURS.filter((tour) => tour.auto).map((tour) => tour.id)).toEqual(['welcome']);
    expect(new Set(TOURS.map((tour) => tour.id)).size).toBe(TOURS.length);
  });

  it('has Arabic and English copy for every tour and every step (no missing or empty text)', () => {
    for (const tour of TOURS) {
      const ids = tour.steps.map((step) => step.id);
      expect(new Set(ids).size, tour.id).toBe(ids.length);
      for (const tree of [guideAr, guideEn]) {
        for (const key of ['name', 'summary']) expect(String(get(tree, `tour.${tour.id}.${key}`) ?? '').trim(), `${tour.id}.${key}`).not.toBe('');
        if (tour.dynamic) expect(String(get(tree, `tour.${tour.id}.where`) ?? '').trim(), `${tour.id}.where`).not.toBe('');
        for (const step of tour.steps) {
          for (const part of ['title', 'body']) expect(String(get(tree, `tour.${tour.id}.${step.id}.${part}`) ?? '').trim(), `${tour.id}.${step.id}.${part}`).not.toBe('');
        }
      }
    }
  });

  it('targets only elements that exist in the app source (ids, data attributes, hrefs) — guards drift', () => {
    for (const tour of TOURS) {
      for (const step of tour.steps.filter((entry) => entry.target)) {
        const selector = step.target!;
        for (const id of selector.matchAll(/#([\w-]+)/g)) expect(sourceText.includes(`id="${id[1]}"`), `${tour.id}.${step.id}: #${id[1]}`).toBe(true);
        for (const anchor of selector.matchAll(/\[data-guide="([\w-]+)"\]/g)) expect(sourceText.includes(`guideId="${anchor[1]}"`) || sourceText.includes(`data-guide="${anchor[1]}"`), `${tour.id}.${step.id}: data-guide=${anchor[1]}`).toBe(true);
        for (const attr of selector.replace(/\[data-guide="[\w-]+"\]/g, '').matchAll(/\[(data-[\w-]+)(?:=|\])/g)) expect(sourceText.includes(attr[1]), `${tour.id}.${step.id}: ${attr[1]}`).toBe(true);
        for (const labelled of selector.matchAll(/aria-labelledby="([\w-]+)"/g)) expect(sourceText.includes(`"${labelled[1]}"`), `${tour.id}.${step.id}: ${labelled[1]}`).toBe(true);
        for (const href of selector.matchAll(/href="([^"]+)"/g)) expect(sourceText.includes(href[1].replace(OPS_BASE, '${OPS_BASE}')), `${tour.id}.${step.id}: ${href[1]}`).toBe(true);
      }
    }
  });

  it('only cites permission keys that exist in the backend catalog', () => {
    const rbac = join(webRoot, '..', 'app/Support/Rbac.php');
    if (!existsSync(rbac)) return;
    const backend = readFileSync(rbac, 'utf8');
    const keys = new Set(TOURS.flatMap((tour) => [...tour.requires, ...tour.steps.flatMap((step) => [...(step.requires ?? []), ...(step.requiresAny ?? [])])]));
    for (const key of keys) expect(backend, key).toContain(`'${key}'`);
  });

  it('points every tour at a real screen inside the app', () => {
    for (const tour of TOURS) {
      expect(tour.entry.startsWith(OPS_BASE), tour.id).toBe(true);
      if (!tour.dynamic) {
        expect(tour.route.test(tour.entry), `${tour.id} entry matches its own route`).toBe(true);
        const rel = tour.entry.replace(/^\//, '');
        expect(existsSync(join(webRoot, 'src/app/(fuel-ops)', rel, 'page.tsx')), tour.entry).toBe(true);
      }
    }
    expect(getTour('collection')?.dynamic).toBe(true);
  });

  it('routes a pathname to its tour and handles trailing slashes', () => {
    expect(tourForPathname(OPS_BASE)?.id).toBe('welcome');
    expect(tourForPathname(`${OPS_BASE}/shifts/`)?.id).toBe('shifts');
    expect(tourForPathname(`${OPS_BASE}/shifts/abc/handover`)?.id).toBe('collection');
    expect(tourForPathname(`${OPS_BASE}/products`)?.id).toBe('sales');
    expect(tourForPathname(`${OPS_BASE}/tanks`)?.id).toBe('stock');
    expect(tourForPathname(`${OPS_BASE}/tanks/xyz`)).toBeUndefined();
    expect(tourForPathname(`${OPS_BASE}/receiving`)).toBeUndefined();
  });

  it('never explains what the user cannot do: tours and steps follow permissions', () => {
    const can = (granted: string[]) => (permission: string) => granted.includes(permission);
    expect(tourAvailable(getTour('collection')!, can(['fuel_stations.view']))).toBe(false);
    expect(tourAvailable(getTour('collection')!, can(['fuel_stations.view', 'fuel.shift.close']))).toBe(true);
    expect(tourAvailable(getTour('shifts')!, can(['fuel_stations.view']))).toBe(false);
    const howToOpen = getTour('shifts')!.steps.find((step) => step.id === 'howToOpen')!;
    expect(stepPermitted(howToOpen, can(['fuel.shift.view']))).toBe(false);
    expect(stepPermitted(howToOpen, can(['fuel.shift.open']))).toBe(true);
    const price = getTour('sales')!.steps.find((step) => step.id === 'price')!;
    expect(stepPermitted(price, can(['fuel_stations.view']))).toBe(false);
    const receiving = getTour('stock')!.steps.find((step) => step.id === 'receiving')!;
    expect(stepPermitted(receiving, can(['fuel_stations.view']))).toBe(false);
    expect(stepPermitted(receiving, can(['fuel.delivery.view']))).toBe(true);
  });
});

describe('Smart Guide never acts for the user', () => {
  const guideDir = fileURLToPath(new URL('.', import.meta.url));
  const files = readdirSync(guideDir).filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file));
  const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*')).join('\n');

  it.each(files)('%s has no click/submit/network capability', (file) => {
    const source = code(readFileSync(join(guideDir, file), 'utf8'));
    expect(source).not.toMatch(/\.click\(|\.submit\(|requestSubmit|dispatchEvent|fetch\(|XMLHttpRequest|\bapi\(|opsWrite|opsGet|sendBeacon/);
    expect(source).not.toMatch(/from '@\/lib\/api'|from '\.\.\/(write|read)-client'/);
  });
});
