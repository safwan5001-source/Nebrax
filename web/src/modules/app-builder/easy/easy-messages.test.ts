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

describe('Easy mode i18n coverage', () => {
  for (const [name, catalog] of [['ar', ar], ['en', en]] as const) {
    it(`every easy.* key used in code exists in ${name}.json`, () => {
      const easy = (catalog as unknown as { appBuilder: { builder: { easy: Record<string, unknown> } } }).appBuilder.builder.easy;
      const missing = used().filter((key) => typeof key.split('.').reduce<unknown>((o, p) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[p] : undefined), easy) !== 'string');
      expect(missing).toEqual([]);
    });
  }
});
