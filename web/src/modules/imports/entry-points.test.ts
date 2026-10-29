import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HUB_ENTITIES } from './catalog';

/**
 * IMP-H8-S3 — كل كيان في مركز الاستيراد يملك مدخلاً **عادياً ظاهراً في صفحته الخاصة** (لا يُخفى خلف المساعد، ولا يتوقف وجوده على مركز الاستيراد وحده). المدخل ليس رابطاً
 * إلى المركز: هو رابط مباشر إلى معالج الاستيراد العادي، يحرسه هذا الاختبار من أن يُحذف أثناء إعادة تصميم قائمة لاحقاً. مصدر الصفحة يُقرأ نصاً لأن الرابط يُبنى في JSX.
 */
const ENTITY_PAGE: Record<string, { page: string; needle: string }> = {
  products: { page: 'products/page.tsx', needle: '/products/import' },
  categories: { page: 'inventory-settings/categories/page.tsx', needle: '/inventory-settings/categories/import' },
  brands: { page: 'inventory-settings/brands/page.tsx', needle: '/inventory-settings/brands/import' },
  unit_templates: { page: 'inventory-settings/units/page.tsx', needle: '/inventory-settings/units/import' },
  price_list_items: { page: 'sales-settings/pricelists/page.tsx', needle: '/sales-settings/pricelists/import' },
  inventory_openings: { page: 'inventory-openings/page.tsx', needle: '/inventory-openings/import' },
  stock_permits: { page: 'stock-permits/page.tsx', needle: '/stock-permits/import' },
  // الجرد: المدخل في صفحة الجرد نفسه (الاستيراد يخص جرداً بعينه)، والقائمة هي هدف المركز
  stocktake_counts: { page: 'stocktaking/[id]/page.tsx', needle: '/import`' },
  customers: { page: 'partners/page.tsx', needle: '/partners/import' },
  suppliers: { page: 'suppliers/page.tsx', needle: '/suppliers/import' },
  purchases: { page: 'purchases/page.tsx', needle: '/purchases/import' },
  expenses: { page: 'expenses/page.tsx', needle: '/expenses/import' },
};

const source = (page: string) => readFileSync(join(process.cwd(), 'src/app/(app)', page), 'utf8');

describe('import entry points on entity pages (IMP-H8-S3)', () => {
  it('declares a page for every hub entity', () => {
    expect(Object.keys(ENTITY_PAGE).sort()).toEqual(HUB_ENTITIES.map((entity) => entity.key).sort());
  });

  it.each(Object.entries(ENTITY_PAGE))('%s links to its standard import from its own page', (_key, { page, needle }) => {
    expect(source(page)).toContain(needle);
  });

  it('the products page keeps the standard and workbook paths next to the assistant one, never behind it', () => {
    const products = source('products/page.tsx');
    expect(products).toContain("href: '/products/import'");
    expect(products).toContain("href: '/products/workbook-import'");
    expect(products).toContain("href: '/products/ai-import'");
  });

  it('only products offers an assistant import entry (no entity page invents one)', () => {
    for (const [key, { page }] of Object.entries(ENTITY_PAGE)) {
      if (key === 'products') continue;
      expect(source(page), page).not.toContain('ai-import');
    }
  });
});
