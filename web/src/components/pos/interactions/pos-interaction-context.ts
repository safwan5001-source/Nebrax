export type PosFocusZone = 'search' | 'products' | 'cart' | 'payment' | 'dialog';
export type PosSaleStep = 'sale' | 'payment';

/**
 * أعلام الحوارات/الطبقات التي تحجب اختصارات البيع والتنقل.
 *
 * PR-4: مساحة عمل «الفواتير» **ليست** حواراً — لا مدخل لها هنا. الصفحة تحجب
 * سكانر الباركود وتنقّل لوحة المفاتيح للمنتجات/السلة عبر شرط منفصل
 * (`workspaceMode === 'products'`) عند نقطة الاستهلاك مباشرة، ومعالجات
 * الاختصارات الحسّاسة (الدفع/الحذف/إلخ) تُمرَّر `undefined` صراحةً خارج وضع
 * المنتجات بدل توسيع هذا العقد المشترك بحقل خاص بشاشة واحدة.
 */
export interface PosDialogFlags {
  pickerOpen: boolean;
  retrieveOpen: boolean;
  returnOpen: boolean;
  exchangeOpen: boolean;
  openCartsOpen: boolean;
  clearCartOpen: boolean;
  noteOpen: boolean;
  sensitiveActionOpen: boolean;
  closeOpen: boolean;
  unsavedExitOpen: boolean;
  sessionGateOpen: boolean;
}

export function isPosDialogOpen(flags: PosDialogFlags): boolean {
  return flags.pickerOpen
    || flags.retrieveOpen
    || flags.returnOpen
    || flags.exchangeOpen
    || flags.openCartsOpen
    || flags.clearCartOpen
    || flags.noteOpen
    || flags.sensitiveActionOpen
    || flags.closeOpen
    || flags.unsavedExitOpen
    || flags.sessionGateOpen;
}

/** يحجب اختصارات/تنقل البيع (لا Esc المُمرَّر صراحةً من الصفحة). */
export function isPosSaleInteractionBlocked(ctx: {
  step: PosSaleStep;
  dialogOpen: boolean;
}): boolean {
  return ctx.dialogOpen || ctx.step === 'payment';
}

export interface PosShortcutBlockOptions {
  blockedWhenDialog?: boolean;
  blockedInPayment?: boolean;
}

/** هل يُحجب هذا الاختصار في السياق الحالي؟ */
export function isPosShortcutBlocked(
  shortcutId: string,
  options: PosShortcutBlockOptions,
  ctx: { step: PosSaleStep; dialogOpen: boolean },
): boolean {
  if (shortcutId === 'back') {
    if (ctx.dialogOpen) return true;
    return false;
  }
  if (ctx.dialogOpen && (options.blockedWhenDialog ?? true)) return true;
  if (ctx.step === 'payment' && (options.blockedInPayment ?? true)) return true;
  return false;
}
