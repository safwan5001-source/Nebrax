import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import ar from '@/messages/ar.json';
import en from '@/messages/en.json';

/**
 * ERP-UX-008: قائمة «نوع المستند» تعرض `t(\`entity_${key}\`)` لكل نوع يعيده الخادم؛
 * نوعٌ بلا تسمية ظهر مفتاحاً خاماً (`numberingSettings.entity_delivery_note`).
 * المصدر هو كتالوج الخادم نفسه، فيُقرأ هنا كي لا تتكرر الفجوة حين يُضاف نوع جديد.
 */
const catalogPath = fileURLToPath(new URL('../../../../../app/Support/DocumentNumberingCatalog.php', import.meta.url));
const entityKeys = [...readFileSync(catalogPath, 'utf8').matchAll(/^ {8}'([a-z_]+)' => \[/gm)].map((m) => m[1]);

describe('numbering settings entity labels', () => {
  it('reads the server catalog', () => {
    expect(entityKeys.length).toBeGreaterThan(20);
    expect(entityKeys).toContain('invoice');
  });

  it.each(['ar', 'en'] as const)('has a %s label for every document type the server can return', (locale) => {
    const messages = (locale === 'ar' ? ar : en).numberingSettings as Record<string, string>;
    const missing = entityKeys.filter((key) => !messages[`entity_${key}`]);
    expect(missing).toEqual([]);
  });
});
