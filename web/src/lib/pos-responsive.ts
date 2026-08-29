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

export const POS_SALE_GRID_CLASS =
  'grid min-h-0 flex-1 grid-cols-1 overflow-hidden md:grid-cols-[minmax(280px,340px)_minmax(0,1fr)] lg:grid-cols-[minmax(300px,340px)_minmax(0,1fr)_104px] xl:grid-cols-[minmax(360px,420px)_minmax(0,1fr)_148px]';

export const POS_MOBILE_NAV_CLASS =
  'grid min-h-16 shrink-0 grid-cols-4 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden';

export const POS_CART_FAB_CLASS =
  'absolute inset-x-3 bottom-3 z-10 flex h-12 items-center gap-3 rounded-md bg-primary px-4 text-white touch-manipulation md:hidden';

export const POS_CART_PAY_FOOTER_CLASS =
  'p-3 pt-0 md:pb-[max(0.75rem,env(safe-area-inset-bottom))]';

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

export function posShowsSplitCart(width: number): boolean {
  return width >= 768;
}
