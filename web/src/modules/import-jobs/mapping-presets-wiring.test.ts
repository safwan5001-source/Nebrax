import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * IMP-H8-S2b — كل معالج استيراد يحمل شريط المطابقات المحفوظة **بمجاله هو**: مجالٌ خاطئ يحفظ المطابقات تحت مجال آخر (وتُرفض/تُخفى بصلاحيته). الاختبار يقرأ مصدر المعالج لأن الشريط
 * يُركَّب داخل JSX المعالج، ويقارن مجال الشريط بمجال المحرّك (`useImportJobEngine`) في الملف نفسه.
 */
const WIZARDS = [
  'stock-permits/import/StockPermitImportWizard.tsx',
  'stocktaking/import/StocktakeCountImportWizard.tsx',
  'price-list-items/import/PriceListItemImportWizard.tsx',
  'unit-templates/import/UnitTemplateImportWizard.tsx',
  'product-taxonomy/import/ProductTaxonomyImportWizard.tsx',
  'purchases/import/PurchaseImportWizard.tsx',
  'expenses/import/ExpenseImportWizard.tsx',
  'partners/import/PartnerImportWizard.tsx',
];

/** صفحات الاستيراد (لا معالجات الوحدات): تمرّر `applyPresetMapping` الذي يُسقط المعاينة بنفسه (IMP-H8-S2c). */
const PAGES = [
  'app/(app)/products/import/page.tsx',
  'app/(app)/products/workbook-import/page.tsx',
  'app/(app)/inventory-openings/import/page.tsx',
];

describe('saved mapping presets wiring (IMP-H8-S2b)', () => {
  it.each(WIZARDS)('%s mounts the bar with its own engine domain and drops the preview on apply', (file) => {
    const source = readFileSync(join(process.cwd(), 'src/modules', file), 'utf8');
    const engine = /useImportJobEngine\('([a-z_]+)'\)/.exec(source)?.[1];
    const bar = /<MappingPresetBar domain="([a-z_]+)"/.exec(source)?.[1];
    expect(engine, 'engine domain').toBeTruthy();
    expect(bar, 'bar domain').toBe(engine);
    // تطبيق مطابقة محفوظة تغيير يدوي للمطابقة: يُسقط المعاينة كأي تعديل
    expect(source).toMatch(/onApply=\{\(next\) => \{ setMapping\(next\); invalidatePreview\(\); \}\}/);
  });

  it.each(PAGES)('%s mounts the bar with its own engine domain and drops the preview through applyPresetMapping', (file) => {
    const source = readFileSync(join(process.cwd(), 'src', file), 'utf8');
    const engine = /useImportJobEngine\('([a-z_]+)'\)/.exec(source)?.[1];
    const bar = /<MappingPresetBar domain="([a-z_]+)"/.exec(source)?.[1];
    expect(engine, 'engine domain').toBeTruthy();
    expect(bar, 'bar domain').toBe(engine);
    expect(source).toContain('onApply={applyPresetMapping}');
    const body = /function applyPresetMapping\(next: ColumnMapping\) \{([\s\S]*?)\n  \}/.exec(source)?.[1] ?? '';
    expect(body).toContain('setMapping(next)');
    expect(body).toContain('setPreview(null)');
  });
});
