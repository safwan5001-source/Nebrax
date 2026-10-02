/**
 * قشرة POS الاستجابية فقط — لا حالة سلة، لا حسابات، ولا منطق مالي.
 *
 * POS UI V3-5:
 * - تحت 900px: مساحتان صريحتان (منتجات أو سلة بارتفاع كامل) وشريط معاملة لاصق.
 * - من 900px إلى ما قبل xl: انقسام 65/35 مع حد أدنى للسلة 280px وأعمدة كتالوج أقل.
 * - من xl (1280): الانقسام الكامل مع استعادة كثافة الأعمدة.
 *
 * ترتيب DOM: الكتالوج ثم السلة، فيطابق المخطط في LTR وينعكس في RTL.
 */

/** 13fr كتالوج / 7fr سلة ≈ 65/35. الانقسام يبدأ عند 900px لا عند 768. */
export const POS_SALE_GRID_CLASS =
  'grid min-h-0 min-w-0 flex-1 grid-cols-1 overflow-hidden min-[900px]:grid-cols-[minmax(0,13fr)_minmax(280px,7fr)] xl:grid-cols-[minmax(0,13fr)_minmax(320px,7fr)]';

export const POS_MOBILE_NAV_CLASS =
  'grid min-h-16 shrink-0 grid-cols-4 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] min-[900px]:hidden';

/** شريط المعاملة تحت 900px: العدد والإجمالي وعرض السلة/الدفع. ليس زرًا عائمًا. */
export const POS_TRANSACTION_BAR_CLASS =
  'flex min-h-14 shrink-0 items-center gap-2 border-t border-border bg-surface px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] min-[900px]:hidden';

export const POS_CART_PAY_FOOTER_CLASS =
  'p-3 pt-0 min-[900px]:pb-[max(0.75rem,env(safe-area-inset-bottom))]';

/** مساحة عمل المنتجات: كثافة ثابتة بلا تضخيم إضافي عند lg حتى لا نخسر عرض iPad. */
export const POS_PRODUCTS_PANEL_CLASS =
  'flex min-h-0 flex-col gap-3 overflow-y-auto p-3 sm:p-4';

const POS_PRODUCT_GRID_WITH_IMAGES_CLASS =
  'grid-cols-2 min-[900px]:grid-cols-2 lg:grid-cols-2 xl:grid-cols-4';

const POS_PRODUCT_GRID_COMPACT_CLASS =
  'grid-cols-2 sm:grid-cols-2 min-[900px]:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-6';

export function posCartPaneClass(mobileTab: 'products' | 'cart'): string {
  return mobileTab === 'cart'
    ? 'flex h-full min-h-0 min-w-0 flex-1 overflow-hidden'
    : 'hidden min-[900px]:flex min-[900px]:h-full min-[900px]:min-h-0 min-[900px]:min-w-0 min-[900px]:overflow-hidden';
}

export function posProductsPaneClass(mobileTab: 'products' | 'cart'): string {
  return mobileTab === 'products'
    ? 'relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden'
    : 'hidden min-[900px]:flex min-[900px]:h-full min-[900px]:min-h-0 min-[900px]:min-w-0 min-[900px]:flex-col min-[900px]:overflow-hidden';
}

export function posProductGridPadClass(_hasCartItems: boolean): string {
  return '';
}

/**
 * شبكة المنتجات لا تعتمد على عدد أعمدة ثابت في تنقل الكيبورد؛ التنقل يقرأ هندسة العناصر الفعلية.
 * تحت 900px نُقلّل الأعمدة قبل أن نصغّر أهداف اللمس.
 */
export function posProductGridClass(
  showImages: boolean,
  hasCartItems: boolean,
  density: 'compact' | 'standard' | 'visual' = 'standard',
): string {
  const columns = density === 'compact'
    ? POS_PRODUCT_GRID_COMPACT_CLASS
    : density === 'visual' && showImages
      ? 'grid-cols-2 min-[900px]:grid-cols-2 xl:grid-cols-3'
      : showImages
        ? POS_PRODUCT_GRID_WITH_IMAGES_CLASS
        : POS_PRODUCT_GRID_COMPACT_CLASS;
  return `grid gap-3 outline-none ${columns}${posProductGridPadClass(hasCartItems)}`;
}

export function posShowsSplitCart(width: number): boolean {
  return width >= 900;
}