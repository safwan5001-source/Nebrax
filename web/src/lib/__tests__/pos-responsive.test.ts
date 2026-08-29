import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  POS_CART_FAB_CLASS,
  POS_CART_PAY_FOOTER_CLASS,
  POS_MOBILE_NAV_CLASS,
  POS_SALE_GRID_CLASS,
  posCartPaneClass,
  posProductGridPadClass,
  posProductsPaneClass,
  posShowsSplitCart,
} from '@/lib/pos-responsive';

function source(file: string) {
  return readFileSync(resolve(process.cwd(), file), 'utf8');
}

describe('قشرة نقطة البيع المتجاوبة', () => {
  it('يثبّت توزيع md ثم iPad landscape مضغوطاً ويعيد الثلاثي الكامل على xl', () => {
    expect(POS_SALE_GRID_CLASS).toContain('grid-cols-1');
    expect(POS_SALE_GRID_CLASS).toContain('md:grid-cols-[minmax(280px,340px)_minmax(0,1fr)]');
    expect(POS_SALE_GRID_CLASS).toContain('lg:grid-cols-[minmax(300px,340px)_minmax(0,1fr)_104px]');
    expect(POS_SALE_GRID_CLASS).toContain('xl:grid-cols-[minmax(360px,420px)_minmax(0,1fr)_148px]');
    expect(posShowsSplitCart(767)).toBe(false);
    expect(posShowsSplitCart(768)).toBe(true);
    expect(posShowsSplitCart(834)).toBe(true);
    expect(posShowsSplitCart(1023)).toBe(true);
  });

  it('يخفي الشريط السفلي وFAB تحت md ويعيد البادئة عند التابلت', () => {
    expect(POS_MOBILE_NAV_CLASS).toContain('md:hidden');
    expect(POS_MOBILE_NAV_CLASS).toContain('safe-area-inset-bottom');
    expect(POS_CART_FAB_CLASS).toContain('md:hidden');
    expect(POS_CART_PAY_FOOTER_CLASS).toContain('md:pb-[max(0.75rem,env(safe-area-inset-bottom))]');
    expect(posProductGridPadClass(true)).toBe(' pb-16 md:pb-0');
    expect(posProductGridPadClass(false)).toBe('');
  });

  it('يعرض السلة والمنتجات معاً من md حتى لو بقي تبويب الجوال على المنتجات', () => {
    expect(posCartPaneClass('products')).toContain('hidden md:flex');
    expect(posCartPaneClass('products')).not.toContain('lg:flex');
    expect(posCartPaneClass('cart')).toContain('flex min-h-0');
    expect(posProductsPaneClass('cart')).toContain('hidden md:flex');
    expect(posProductsPaneClass('products')).toContain('relative flex');
  });

  it('يحافظ على دعم اللمس والماوس والكيبورد في سطح البيع', () => {
    const page = source('src/app/(pos)/pos/page.tsx');
    const tile = source('src/components/pos/pos-product-tile.tsx');

    expect(page).toContain('usePosKeyboardActive');
    expect(page).toContain('usePosKeyboardShortcuts');
    expect(page).toContain('usePosFocusManager');
    expect(page).toContain('interaction_mode');
    expect(tile).toContain('touch-manipulation');
    expect(tile).toContain('hover:border-primary');
    expect(tile).toContain('focus-visible:ring-2');
  });

  it('يربط صفحة البيع بالمساعد دون لمس auth أو Dialog العام', () => {
    const page = source('src/app/(pos)/pos/page.tsx');
    expect(page).toContain('POS_SALE_GRID_CLASS');
    expect(page).toContain('posCartPaneClass');
    expect(page).toContain('posProductsPaneClass');
    expect(page).toContain('POS_CART_FAB_CLASS');
    expect(page).toContain('POS_MOBILE_NAV_CLASS');
    expect(page).not.toContain("from '@/components/ui/dialog'");

    const dialog = source('src/components/ui/dialog.tsx');
    expect(dialog).not.toContain('pos-dialog-body');
    expect(dialog).not.toContain("from '@/components/pos/");

    const auth = source('src/lib/auth.ts');
    expect(auth).not.toContain('pos-responsive');
    expect(auth).not.toContain('PosDialog');
  });
});
