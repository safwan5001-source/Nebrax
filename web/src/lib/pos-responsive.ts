/**
 * قشرة POS الاستجابية فقط — لا حالة سلة، لا حسابات، ولا منطق مالي.
 *
 * POS UI V3 — أساس الشبكة:
 * - الجوال (< md): مساحة عمل واحدة (منتجات أو سلة) مع التنقّل السفلي.
 * - من md فصاعداً: عمودان فقط، الكتالوج ثم السلة، حوالي 65/35 (13fr/7fr).
 *   الحدّ الأدنى للسلة يبقى تحت حصة 35% حتى لا يظهر تمرير أفقي على 768 و1024.
 * - شريط الأقسام لم يعد عموداً ثالثاً. في V3-1 يبقى داخل عمود الكتالوج؛
 *   V3-2 يستبدله بشريط أفقي.
 *
 * ترتيب DOM: الكتالوج ثم السلة، فيطابق المخطط في LTR وينعكس في RTL.
 */

/** 13fr كتالوج / 7fr سلة ≈ 65/35. الحد الأدنى للسلة أقل من 35% عند أضيق split (768). */
export const POS_SALE_GRID_CLASS =
  'grid min-h-0 min-w-0 flex-1 grid-cols-1 overflow-hidden md:grid-cols-[minmax(0,13fr)_minmax(240px,7fr)] lg:grid-cols-[minmax(0,13fr)_minmax(280px,7fr)] xl:grid-cols-[minmax(0,13fr)_minmax(320px,7fr)]';

export const POS_MOBILE_NAV_CLASS =
  'grid min-h-16 shrink-0 grid-cols-4 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden';

export const POS_CART_FAB_CLASS =
  'absolute inset-x-3 bottom-3 z-10 flex h-12 items-center gap-3 rounded-md bg-primary px-4 text-white touch-manipulation md:hidden';

export const POS_CART_PAY_FOOTER_CLASS =
  'p-3 pt-0 md:pb-[max(0.75rem,env(safe-area-inset-bottom))]';

/** مساحة عمل المنتجات: كثافة ثابتة بلا تضخيم إضافي عند lg حتى لا نخسر عرض iPad. */
export const POS_PRODUCTS_PANEL_CLASS =
  'flex min-h-0 flex-col gap-3 overflow-y-auto p-3 sm:p-4';

const POS_PRODUCT_GRID_WITH_IMAGES_CLASS =
  'grid-cols-2 sm:grid-cols-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5';

const POS_PRODUCT_GRID_COMPACT_CLASS =
  'grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6';

export function posCartPaneClass(mobileTab: 'products' | 'cart'): string {
  return mobileTab === 'cart'
    ? 'flex min-h-0 min-w-0 overflow-hidden'
    : 'hidden md:flex md:min-h-0 md:min-w-0 md:overflow-hidden';
}

export function posProductsPaneClass(mobileTab: 'products' | 'cart'): string {
  return mobileTab === 'products'
    ? 'relative flex min-h-0 min-w-0 flex-col overflow-hidden'
    : 'hidden md:flex md:min-h-0 md:min-w-0 md:flex-col md:overflow-hidden';
}

export function posProductGridPadClass(hasCartItems: boolean): string {
  return hasCartItems ? ' pb-16 md:pb-0' : '';
}

/**
 * شبكة المنتجات لا تعتمد على عدد أعمدة ثابت في تنقل الكيبورد؛ التنقل يقرأ هندسة العناصر الفعلية.
 * لذلك نضبط الكثافة حسب المساحة المتاحة، مع حماية iPad landscape من بطاقات شديدة الضيق.
 */
export function posProductGridClass(
  showImages: boolean,
  hasCartItems: boolean,
  density: 'compact' | 'standard' | 'visual' = 'standard',
): string {
  const columns = density === 'compact'
    ? POS_PRODUCT_GRID_COMPACT_CLASS
    : density === 'visual' && showImages
      ? 'grid-cols-2 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
      : showImages
        ? POS_PRODUCT_GRID_WITH_IMAGES_CLASS
        : POS_PRODUCT_GRID_COMPACT_CLASS;
  return `grid gap-3 outline-none ${columns}${posProductGridPadClass(hasCartItems)}`;
}

export function posShowsSplitCart(width: number): boolean {
  return width >= 768;
}
