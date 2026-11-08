import { describe, expect, it } from 'vitest';
import ar from '@/messages/ar.json';
import en from '@/messages/en.json';

type Tree = { [key: string]: string | Tree };
const keys = (tree: Tree, prefix = ''): string[] => Object.entries(tree).flatMap(([k, v]) => (typeof v === 'string' ? [`${prefix}${k}`] : keys(v, `${prefix}${k}.`)));

describe('رسائل التقارير', () => {
  const a = (ar as unknown as { fuelReports: Tree }).fuelReports;
  const e = (en as unknown as { fuelReports: Tree }).fuelReports;

  it('العربية والإنجليزية بمفاتيح متطابقة وبلا نص فارغ', () => {
    expect(keys(a).sort()).toEqual(keys(e).sort());
    for (const tree of [a, e]) for (const k of keys(tree)) expect(k.split('.').reduce<string | Tree>((c, p) => (c as Tree)[p], tree)).not.toBe('');
  });

  it('عنصر التنقل في كلتا اللغتين', () => {
    expect((ar as unknown as { stationOps: { navReports: string } }).stationOps.navReports).toBe('التقارير');
    expect((en as unknown as { stationOps: { navReports: string } }).stationOps.navReports).toBe('Reports');
  });
});
