/**
 * وسيلة الإدخال الفعّالة في نقطة البيع — حقيقة واحدة للماسح واللمس والكيبورد.
 * ليست إعداداً دائماً ولا تُخزَّن؛ تُشتق من آخر حدث فعلي.
 */
export type PosInputModality = 'keyboard' | 'pointer' | 'scanner';

/** توافق مع تسمية PR-3. */
export type PosLastInput = PosInputModality;

export interface PosKeyIdentity {
  key: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
}

const CART_QTY_KEYS = new Set(['+', '-', '=', '_']);

/**
 * مفتاح تنقّل/اختصار يفعّل Keyboard Power Mode.
 * أحرف الماسح القابلة للطباعة وEnter (يُغلق بها الإسفين المسح) ليست تنقّلاً.
 */
export function isPosKeyboardNavigationKey(event: PosKeyIdentity): boolean {
  if (event.ctrlKey || event.altKey || event.metaKey) return true;
  const { key } = event;
  if (key === 'Enter') return false;
  if (key === 'Tab' || key === 'Escape' || key === 'Delete' || key === 'Backspace') return true;
  if (key.startsWith('Arrow')) return true;
  if (key === 'Home' || key === 'End' || key === 'PageUp' || key === 'PageDown') return true;
  if (/^F(?:[1-9]|1[0-2])$/.test(key)) return true;
  return CART_QTY_KEYS.has(key);
}

/** استعادة التركيز بعد الحوار للكيبورد فقط — لا بعد لمس ولا بعد مسح. */
export function shouldRestorePosFocus(lastInput: PosInputModality): boolean {
  return lastInput === 'keyboard';
}
