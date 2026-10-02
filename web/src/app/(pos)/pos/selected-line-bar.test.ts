import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { POS_SALE_GRID_CLASS, posCartPaneClass } from '@/lib/pos-responsive';

function source(file: string) {
  return readFileSync(resolve(process.cwd(), file), 'utf8');
}

describe('POS-FINAL-1 شريط السطر المحدد', () => {
  const page = source('src/app/(pos)/pos/page.tsx');
  const linesStart = page.indexOf('data-testid="pos-cart-lines"');
  const barStart = page.indexOf('data-testid="pos-selected-line-controls"');
  const lineRegion = page.slice(linesStart, barStart);
  const barRegion = page.slice(barStart, page.indexOf('data-awj-floor-actions'));

  it('يزيل منتقي الوحدة من جسم السطر ويبقي الاسم نصاً', () => {
    expect(linesStart).toBeGreaterThan(-1);
    expect(barStart).toBeGreaterThan(linesStart);
    expect(lineRegion).not.toContain('<select');
    expect(lineRegion).toContain('data-testid="pos-cart-line-unit"');
    expect(page).not.toContain('<select');
  });

  it('يضع الوحدة والكمية في الصف الأول والسعر والخصم والحذف في الصف الثاني داخل عمود السلة', () => {
    expect(barRegion).toContain('data-testid="pos-selected-line-row-primary"');
    expect(barRegion).toContain('data-testid="pos-selected-line-row-secondary"');
    expect(barRegion.indexOf('PosSelectedLineUnitControl')).toBeLessThan(barRegion.indexOf('PosCartQtyControls'));
    expect(barRegion.indexOf('pos-selected-line-row-secondary')).toBeLessThan(barRegion.indexOf('allow_unit_price_override'));
    expect(barRegion).toContain('posCfg.allow_unit_price_override &&');
    expect(barRegion).toContain('posCfg.allow_discount &&');
    expect(barRegion).toContain('name="pos-discount-mode"');
    expect(barRegion).toContain('setDiscount(selectedLine.key, value)');
    expect(barRegion).toContain('discountMinorFromPercent');
    expect(barRegion).toContain('remove(selectedLine.key)');
    expect(barRegion).not.toContain('fixed ');
    expect(barRegion).not.toContain('md:hidden');
    const primary = barRegion.slice(0, barRegion.indexOf('pos-selected-line-row-secondary'));
    const secondary = barRegion.slice(barRegion.indexOf('pos-selected-line-row-secondary'));
    expect(primary).toContain('PosSelectedLineUnitControl');
    expect(primary).toContain('PosCartQtyControls');
    expect(primary).not.toContain('PosNumericEditor');
    expect(secondary).toContain('t(\'unit_price\')');
    expect(secondary).toContain('t(\'discount\')');
    expect(secondary).toContain('PosCartRemoveButton');
  });

  it('يربط تغيير الوحدة بـ planPosCartUnitChange ثم يحدّث selectedLineKey', () => {
    expect(page).toContain('planPosCartUnitChange');
    expect(page).toContain('if (planned) setSelectedLineKey(planned.selectedKey)');
    expect(page).toContain('onChange={(unitName) => selectedLine && setUnit(selectedLine.key, unitName)}');
    expect(page).toContain("setSensitiveAction({ type: 'item_removed'");
  });

  it('لا يضغط شبكة المنتجات ولا يغيّر غلاف الجوال: الشريط داخل السلة والنسبة 1:2 كما هي', () => {
    expect(POS_SALE_GRID_CLASS).toContain('lg:grid-cols-[minmax(280px,1fr)_minmax(0,2fr)_104px]');
    expect(POS_SALE_GRID_CLASS).toContain('xl:grid-cols-[minmax(320px,1fr)_minmax(0,2fr)_148px]');
    expect(POS_SALE_GRID_CLASS).toContain('md:grid-cols-[minmax(280px,340px)_minmax(0,1fr)]');
    expect(page).toContain('POS_SALE_GRID_CLASS');
    expect(page).toContain('posCartPaneClass');
    expect(posCartPaneClass('products')).toContain('hidden md:flex');
    expect(posCartPaneClass('cart').split(/\s+/)).not.toContain('hidden');
    expect(page).toContain('usePosBarcodeScanner');
    expect(page).toContain('usePosCartNavigation');
    expect(page).toContain('usePosKeyboardShortcuts');
  });

  it('المتغير لا يحصل على خيارات وحدة، والوحدة الواحدة تبقى بلا قائمة', () => {
    expect(page).toContain('!selectedLine.productVariantId && selectedUnits.length > 1');
    expect(page).toContain('const unitOptions = canPickUnit');
    expect(page).toContain(': null');
  });
});
