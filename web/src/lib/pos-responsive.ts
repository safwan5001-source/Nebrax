/**
 * قشرة POS الاستجابية فقط — لا حالة سلة، لا حسابات، ولا منطق مالي.
 *
 * قواعد الامتداد البصري للـPOS:
 * - الجوال (< md): مساحة عمل واحدة مع تنقّل سفلي وسلة عائمة.
 * - التابلت (md–lg): السلة والمنتجات فقط حتى تبقى بطاقات المنتج قابلة للقراءة واللمس.
 * - iPad landscape / desktop compact (lg–xl): ثلاثي مضغوط بعرض محافظ للسلة والأقسام.
 * - desktop الواسع (xl+): ثلاثي كامل مع استعادة عرض السلة والأقسام.
 *
 * هذه القيم تخص التخطيط فقط وتستخدم Design Tokens الموجودة في النظام.
 */

/**
 * PR-3: توسيع عمود السلة على lg/xl فقط — التابلت (md) يبقى كما هو حرفياً.
 * المساحة تُستعاد من الفراغ الأفقي غير المستغل بين المنتجات والسلة، لا من
 * تضييق شبكة المنتجات (تبقى `minmax(0,1fr)` مرنة). لا تغيير على الجوال.
 */
export const POS_SALE_GRID_CLASS =
  'grid min-h-0 flex-1 grid-cols-1 overflow-hidden md:grid-cols-[minmax(280px,340px)_minmax(0,1fr)] lg:grid-cols-[minmax(320px,400px)_minmax(0,1fr)_104px] xl:grid-cols-[minmax(400px,480px)_minmax(0,1fr)_148px]';

export const POS_MOBILE_NAV_CLASS =
  'grid min-h-16 shrink-0 grid-cols-4 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden';

export const POS_CART_FAB_CLASS =
  'absolute inset-x-3 bottom-3 z-10 flex h-12 items-center gap-3 rounded-md bg-primary px-4 text-white touch-manipulation md:hidden';

export const POS_CART_PAY_FOOTER_CLASS =
  'p-3 pt-0 md:pb-[max(0.75rem,env(safe-area-inset-bottom))]';

/** مساحة عمل المنتجات: كثافة ثابتة بلا تضخيم إضافي عند lg حتى لا نخسر عرض iPad. */
export const POS_PRODUCTS_PANEL_CLASS =
  'flex min-h-0 flex-col gap-3 overflow-y-auto p-3 sm:p-4';

/** شريط الأقسام الجانبي: مضغوط على lg ثم يستعيد التنفس على xl. */
export const POS_DESKTOP_CATEGORIES_CLASS =
  'hidden flex-col gap-1.5 overflow-y-auto border-s border-border bg-surface p-2 lg:flex xl:gap-2 xl:p-3';

const POS_PRODUCT_GRID_WITH_IMAGES_CLASS =
  'grid-cols-2 sm:grid-cols-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5';

const POS_PRODUCT_GRID_COMPACT_CLASS =
  'grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6';

export function posCartPaneClass(mobileTab: 'products' | 'cart'): string {
  return mobileTab === 'cart'
    ? 'flex min-h-0 overflow-hidden'
    : 'hidden md:flex md:min-h-0 md:overflow-hidden';
}

export function posProductsPaneClass(mobileTab: 'products' | 'cart'): string {
  return mobileTab === 'products'
    ? 'relative flex min-h-0 flex-col overflow-hidden'
    : 'hidden md:flex md:min-h-0 md:flex-col md:overflow-hidden';
}

export function posProductGridPadClass(hasCartItems: boolean): string {
  return hasCartItems ? ' pb-16 md:pb-0' : '';
}

/**
 * شبكة المنتجات لا تعتمد على عدد أعمدة ثابت في تنقل الكيبورد؛ التنقل يقرأ هندسة العناصر الفعلية.
 * لذلك نضبط الكثافة حسب المساحة المتاحة، مع حماية iPad landscape من بطاقات شديدة الضيق.
 */
export function posProductGridClass(showImages: boolean, hasCartItems: boolean): string {
  const columns = showImages ? POS_PRODUCT_GRID_WITH_IMAGES_CLASS : POS_PRODUCT_GRID_COMPACT_CLASS;
  return `grid gap-3 outline-none ${columns}${posProductGridPadClass(hasCartItems)}`;
}

export function posShowsSplitCart(width: number): boolean {
  return width >= 768;
}
