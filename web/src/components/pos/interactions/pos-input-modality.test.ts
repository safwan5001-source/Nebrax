import { describe, expect, it } from 'vitest';
import {
  isPosKeyboardNavigationKey,
  shouldRestorePosFocus,
} from './pos-input-modality';

function key(
  value: string,
  modifiers: { ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean } = {},
) {
  return { key: value, ...modifiers };
}

describe('isPosKeyboardNavigationKey', () => {
  it('يعتبر الأسهم وF-keys وTab وEsc وDelete تنقّلاً', () => {
    for (const value of [
      'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
      'Tab', 'Escape', 'Delete', 'Backspace',
      'F2', 'F4', 'F6', 'F7', 'F8', 'F9',
      'Home', 'End', 'PageDown',
    ]) {
      expect(isPosKeyboardNavigationKey(key(value)), value).toBe(true);
    }
  });

  it('يعتبر اختصارات Ctrl/Alt/Meta تنقّلاً حتى لو الحرف قابلاً للطباعة', () => {
    expect(isPosKeyboardNavigationKey(key('n', { ctrlKey: true }))).toBe(true);
    expect(isPosKeyboardNavigationKey(key('o', { ctrlKey: true, altKey: true }))).toBe(true);
  });

  it('يعتبر +/- تعديلاً للكمية من الكيبورد', () => {
    expect(isPosKeyboardNavigationKey(key('+'))).toBe(true);
    expect(isPosKeyboardNavigationKey(key('-'))).toBe(true);
    expect(isPosKeyboardNavigationKey(key('='))).toBe(true);
  });

  it('لا يعتبر أحرف الماسح أو Enter تنقّل كيبورد', () => {
    expect(isPosKeyboardNavigationKey(key('6'))).toBe(false);
    expect(isPosKeyboardNavigationKey(key('a'))).toBe(false);
    expect(isPosKeyboardNavigationKey(key('Enter'))).toBe(false);
    expect(isPosKeyboardNavigationKey(key(' '))).toBe(false);
  });
});

describe('shouldRestorePosFocus', () => {
  it('يستعيد التركيز للكيبورد فقط', () => {
    expect(shouldRestorePosFocus('keyboard')).toBe(true);
    expect(shouldRestorePosFocus('pointer')).toBe(false);
    expect(shouldRestorePosFocus('scanner')).toBe(false);
  });
});
