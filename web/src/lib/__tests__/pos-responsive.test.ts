import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  POS_CART_FAB_CLASS,
  POS_CART_PAY_FOOTER_CLASS,
  POS_DESKTOP_CATEGORIES_CLASS,
  POS_MOBILE_NAV_CLASS,
  POS_PRODUCTS_PANEL_CLASS,
  POS_SALE_GRID_CLASS,
  posCartPaneClass,
  posProductGridClass,
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
    expect(POS_SALE_GRID_CLASS).toContain('lg:grid-cols-[minmax(320px,400px)_minmax(0,1fr)_104px]');
    expect(POS_SALE_GRID_CLASS).toContain('xl:grid-cols-[minmax(400px,480px)_minmax(0,1fr)_148px]');
    expect(posShowsSplitCart(767)).toBe(false);
    expect(posShowsSplitCart(768)).toBe(true);
    expect(posShowsSplitCart(834)).toBe(true);
    expect(posShowsSplitCart(1023)).toBe(true);
  });

  it('PR-3: يوسّع عمود السلة على lg وxl فقط دون المساس بالتابلت (md)', () => {
    expect(POS_SALE_GRID_CLASS).toContain('md:grid-cols-[minmax(280px,340px)_minmax(0,1fr)]');
    expect(POS_SALE_GRID_CLASS).not.toContain('minmax(300px,340px)');
    expect(POS_SALE_GRID_CLASS).not.toContain('minmax(360px,420px)');
    expect(POS_SALE_GRID_CLASS).toContain('minmax(320px,400px)');
    expect(POS_SALE_GRID_CLASS).toContain('minmax(400px,480px)');
  });

  it('PR-3: عمود السلة يمتد فعلياً على كامل عرض مساره في الشبكة (لا انكماش على عرض المحتوى)', () => {
    // اكتُشف أثناء فحص المتصفح الحقيقي: توسيع مسار الشبكة وحده لا يكفي —
    // الأب Flex لا يمدّد عرض `<aside>` تلقائياً بلا `w-full`، فيبقى العمود
    // منكمشاً على عرض محتواه (~300px) مهما اتسع مسار الشبكة. هذا الاختبار
    // يحرس وجود `w-full` على عنصر السلة حتى لا يتكرر الانكماش الصامت.
    const page = source('src/app/(pos)/pos/page.tsx');
    expect(page).toMatch(/<aside className="flex w-full min-h-0 flex-col overflow-hidden border-border bg-surface md:border-e">/);
  });

  it('يحمي بطاقات الصور من التضييق الزائد على iPad landscape', () => {
    const grid = posProductGridClass(true, false);
    expect(grid).toContain('md:grid-cols-2');
    expect(grid).toContain('lg:grid-cols-3');
    expect(grid).toContain('xl:grid-cols-5');
    expect(grid).not.toContain('lg:grid-cols-4');
  });

  it('يزيد كثافة البطاقات بلا صور تدريجياً حتى 2xl', () => {
    const grid = posProductGridClass(false, false);
    expect(grid).toContain('md:grid-cols-3');
    expect(grid).toContain('lg:grid-cols-4');
    expect(grid).toContain('xl:grid-cols-5');
    expect(grid).toContain('2xl:grid-cols-6');
  });

  it('يحافظ على مساحة المنتجات ولا يعيد تضخيم padding عند lg', () => {
    expect(POS_PRODUCTS_PANEL_CLASS).toContain('p-3');
    expect(POS_PRODUCTS_PANEL_CLASS).toContain('sm:p-4');
    expect(POS_PRODUCTS_PANEL_CLASS).not.toContain('lg:p-5');
    expect(POS_DESKTOP_CATEGORIES_CLASS).toContain('p-2');
    expect(POS_DESKTOP_CATEGORIES_CLASS).toContain('lg:flex');
    expect(POS_DESKTOP_CATEGORIES_CLASS).toContain('xl:p-3');
  });

  it('يخفي الشريط السفلي وFAB تحت md ويعيد البادئة عند التابلت', () => {
    expect(POS_MOBILE_NAV_CLASS).toContain('md:hidden');
    expect(POS_MOBILE_NAV_CLASS).toContain('safe-area-inset-bottom');
    expect(POS_CART_FAB_CLASS).toContain('md:hidden');
    expect(POS_CART_PAY_FOOTER_CLASS).toContain('md:pb-[max(0.75rem,env(safe-area-inset-bottom))]');
    expect(posProductGridPadClass(true)).toBe(' pb-16 md:pb-0');
    expect(posProductGridPadClass(false)).toBe('');
    expect(posProductGridClass(true, true)).toContain('pb-16 md:pb-0');
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

  it('يربط صفحة البيع بمساعدات الاستجابة دون لمس auth أو Dialog العام', () => {
    const page = source('src/app/(pos)/pos/page.tsx');
    expect(page).toContain('POS_SALE_GRID_CLASS');
    expect(page).toContain('POS_PRODUCTS_PANEL_CLASS');
    expect(page).toContain('POS_DESKTOP_CATEGORIES_CLASS');
    expect(page).toContain('posCartPaneClass');
    expect(page).toContain('posProductsPaneClass');
    expect(page).toContain('posProductGridClass');
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

  it('يحافظ على ربط السلة والدفع والإيصال دون إعادة lg:p-5 أو صناديق أيقونات ملوّنة', () => {
    const page = source('src/app/(pos)/pos/page.tsx');
    const payment = source('src/components/pos/pos-payment.tsx');
    const receipt = source('src/components/pos/receipt-dialog.tsx');
    const products = source('src/lib/pos-responsive.ts');

    expect(page).toContain('PosCartLineFrame');
    expect(page).toContain('PosCartQtyControls');
    expect(page).toContain('PosCartRemoveButton');
    expect(page).toContain('PosCartEmptyState');
    expect(page).toContain('usePosBarcodeScanner');
    expect(page).toContain('POS_PRODUCTS_PANEL_CLASS');
    expect(products).not.toContain('lg:p-5');
    expect(page).not.toContain('lg:p-5');

    expect(payment).not.toContain('grid h-8 w-8');
    expect(payment).not.toContain('grid h-5 w-5 place-items-center rounded-md bg-primary');
    expect(payment).toContain('data-testid="pos-confirm-payment"');
    expect(payment).toContain('data-testid="pos-checkout-recovering"');

    expect(receipt).toContain('DocumentView');
    expect(receipt).toContain('DocumentScaler');
    expect(receipt).toContain('printDocument');
    expect(receipt).toContain('pos-receipt-success');
    expect(receipt).not.toContain('max-w-xs');
  });
});
