export type PosShortcutId =
  | 'customer'
  | 'search'
  | 'heldSales'
  | 'holdSale'
  | 'delete'
  | 'payment'
  | 'newCart'
  | 'openCarts'
  | 'back';

export interface PosShortcutModifiers {
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
}

export interface PosShortcutBinding {
  id: PosShortcutId;
  key: string;
  displayKey: string;
  translationKey: string;
  modifiers?: PosShortcutModifiers;
  tone?: 'danger' | 'positive';
  skipWhenEditable: boolean;
  showInFooter?: boolean;
  blockedWhenDialog?: boolean;
  blockedInPayment?: boolean;
}

/** كل ربط مفتاح→اختصار (يشمل بدائل المتصفح غير الظاهرة في الشريط). */
export const POS_SHORTCUT_BINDINGS: readonly PosShortcutBinding[] = [
  { id: 'customer', key: 'F2', displayKey: 'F2', translationKey: 'sc_new_customer', skipWhenEditable: false },
  { id: 'search', key: 'F4', displayKey: 'F4', translationKey: 'sc_search', skipWhenEditable: false },
  { id: 'heldSales', key: 'F6', displayKey: 'F6', translationKey: 'sc_held', skipWhenEditable: false },
  { id: 'holdSale', key: 'F7', displayKey: 'F7', translationKey: 'sc_hold', skipWhenEditable: false },
  { id: 'delete', key: 'F8', displayKey: 'F8', translationKey: 'sc_delete', tone: 'danger', skipWhenEditable: true },
  { id: 'payment', key: 'F9', displayKey: 'F9', translationKey: 'sc_pay', tone: 'positive', skipWhenEditable: false },
  { id: 'newCart', key: 'n', displayKey: 'Ctrl+N', translationKey: 'sc_new_cart', modifiers: { ctrl: true }, skipWhenEditable: true },
  { id: 'newCart', key: 'n', displayKey: 'Ctrl+Alt+N', translationKey: 'sc_new_cart', modifiers: { ctrl: true, alt: true }, skipWhenEditable: true, showInFooter: false },
  { id: 'openCarts', key: 'o', displayKey: 'Ctrl+Shift+O', translationKey: 'sc_open_carts', modifiers: { ctrl: true, shift: true }, skipWhenEditable: true },
  { id: 'openCarts', key: 'o', displayKey: 'Ctrl+Alt+O', translationKey: 'sc_open_carts', modifiers: { ctrl: true, alt: true }, skipWhenEditable: true, showInFooter: false },
  { id: 'back', key: 'Escape', displayKey: 'Esc', translationKey: 'sc_back', skipWhenEditable: false, blockedInPayment: false },
] as const;

/** اختصار واحد لكل معرّف للعرض في شريط الديسكتوب. */
export const POS_SHORTCUT_FOOTER: readonly PosShortcutBinding[] = POS_SHORTCUT_BINDINGS.filter(
  (binding) => binding.showInFooter !== false,
);

/** @deprecated استخدم POS_SHORTCUT_FOOTER — للتوافق مع الاختبارات القديمة. */
export const POS_SHORTCUTS = POS_SHORTCUT_FOOTER;

function modifiersMatch(event: KeyboardEvent, expected?: PosShortcutModifiers): boolean {
  const want = expected ?? {};
  return event.ctrlKey === (want.ctrl ?? false)
    && event.shiftKey === (want.shift ?? false)
    && event.altKey === (want.alt ?? false)
    && event.metaKey === (want.meta ?? false);
}

export function matchPosShortcut(event: KeyboardEvent): PosShortcutBinding | undefined {
  return POS_SHORTCUT_BINDINGS.find(
    (binding) => binding.key === event.key && modifiersMatch(event, binding.modifiers),
  );
}

/** @deprecated */
export function findPosShortcutByKey(key: string): PosShortcutBinding | undefined {
  return POS_SHORTCUT_BINDINGS.find((binding) => binding.key === key && !binding.modifiers);
}

export function posShortcutBindingKey(binding: PosShortcutBinding): string {
  const parts = [
    binding.modifiers?.ctrl ? 'ctrl' : '',
    binding.modifiers?.shift ? 'shift' : '',
    binding.modifiers?.alt ? 'alt' : '',
    binding.modifiers?.meta ? 'meta' : '',
    binding.key,
  ].filter(Boolean);
  return parts.join('+');
}
