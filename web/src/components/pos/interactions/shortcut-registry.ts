export type PosShortcutId = 'customer' | 'search' | 'delete' | 'payment' | 'back';

export interface PosShortcutDefinition {
  id: PosShortcutId;
  /** قيمة `KeyboardEvent.key` كما يرسلها المتصفح. */
  key: string;
  /** ما يظهر داخل `<kbd>` — قد يختصر المفتاح (`Escape` تُعرض `Esc`). */
  displayKey: string;
  /** مفتاح الترجمة داخل مساحة `pos` — لا نص عربي أو إنجليزي مكتوب هنا. */
  translationKey: string;
  tone?: 'danger' | 'positive';
  /** يُتجاهَل حين يكون التركيز داخل حقل قابل للتحرير. */
  skipWhenEditable: boolean;
}

/**
 * مصدر الحقيقة الوحيد لاختصارات نقطة البيع: منه يقرأ مستمع لوحة المفاتيح ومنه
 * يُبنى شريط الاختصارات السفلي. كانا نسختين منفصلتين تتباعدان مع أول تعديل.
 */
export const POS_SHORTCUTS: readonly PosShortcutDefinition[] = [
  { id: 'customer', key: 'F2', displayKey: 'F2', translationKey: 'sc_new_customer', skipWhenEditable: false },
  { id: 'search', key: 'F4', displayKey: 'F4', translationKey: 'sc_search', skipWhenEditable: false },
  { id: 'delete', key: 'F8', displayKey: 'F8', translationKey: 'sc_delete', tone: 'danger', skipWhenEditable: true },
  { id: 'payment', key: 'F9', displayKey: 'F9', translationKey: 'sc_pay', tone: 'positive', skipWhenEditable: false },
  { id: 'back', key: 'Escape', displayKey: 'Esc', translationKey: 'sc_back', skipWhenEditable: false },
] as const;

export function findPosShortcutByKey(key: string): PosShortcutDefinition | undefined {
  return POS_SHORTCUTS.find((shortcut) => shortcut.key === key);
}
