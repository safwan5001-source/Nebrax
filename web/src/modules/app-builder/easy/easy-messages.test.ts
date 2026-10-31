import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import ar from '@/messages/ar.json';
import en from '@/messages/en.json';

/**
 * كل مفتاح `t('easy.…')` يستعمله الوضع السهل يجب أن يوجد في الكتالوجين الحقيقيين.
 * اختبارات المحرر تحقن قاموساً مصغّراً فلا تكشف مفتاحاً ناقصاً؛ هذا الاختبار هو الحارس
 * (كشفه متصفح حقيقي أول مرة: `easy.hideSection` المفقود).
 */
const dir = join(__dirname);
const files = [
  ...readdirSync(dir).filter((f) => f.endsWith('.tsx')).map((f) => join(dir, f)),
  join(__dirname, '../../../app/(commerce)/app-builder/[id]/builder/page.tsx'),
];

function used(): string[] {
  const keys = new Set<string>();
  for (const file of files) {
    for (const m of readFileSync(file, 'utf8').matchAll(/\bt\('easy\.([A-Za-z0-9_.]+)'/g)) keys.add(m[1]);
  }
  return [...keys];
}

/** S03b: مفاتيح `compat.*` و`optional*` في المفتش وتقرير التوافق (مباشرة تحت `appBuilder.builder`). */
const otherFiles = [join(__dirname, '../compat-report.tsx'), join(__dirname, '../inspector.tsx')];
function usedOther(): string[] {
  const keys = new Set<string>();
  for (const file of otherFiles) {
    for (const m of readFileSync(file, 'utf8').matchAll(/\bt\('((?:compat\.[A-Za-z0-9_.]+)|(?:optional[A-Za-z]*))'/g)) keys.add(m[1]);
  }
  return [...keys];
}

describe('Easy mode i18n coverage', () => {
  for (const [name, catalog] of [['ar', ar], ['en', en]] as const) {
    it(`every compat.* / optional* key used by the inspector and compat report exists in ${name}.json`, () => {
      const builder = (catalog as unknown as { appBuilder: { builder: Record<string, unknown> } }).appBuilder.builder;
      const used = usedOther();
      expect(used.length).toBeGreaterThan(8);
      const missing = used.filter((key) => typeof key.split('.').reduce<unknown>((o, p) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[p] : undefined), builder) !== 'string');
      expect(missing).toEqual([]);
    });
  }

  for (const [name, catalog] of [['ar', ar], ['en', en]] as const) {
    it(`every easy.* key used in code exists in ${name}.json`, () => {
      const easy = (catalog as unknown as { appBuilder: { builder: { easy: Record<string, unknown> } } }).appBuilder.builder.easy;
      const missing = used().filter((key) => typeof key.split('.').reduce<unknown>((o, p) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[p] : undefined), easy) !== 'string');
      expect(missing).toEqual([]);
    });
  }
});
