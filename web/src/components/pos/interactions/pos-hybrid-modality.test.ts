// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POS_SHORTCUT_BINDINGS, posShortcutBindingKey } from './shortcut-registry';
import { usePosBarcodeScanner } from './use-pos-barcode-scanner';
import { shouldRestorePosFocus, usePosKeyboardActive } from './use-pos-keyboard-active';

beforeEach(() => { vi.useFakeTimers(); });

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  document.body.innerHTML = '';
});

function press(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  window.dispatchEvent(event);
  return event;
}

function scan(code: string, gapMs = 10): void {
  for (const character of code) {
    press(character);
    vi.advanceTimersByTime(gapMs);
  }
}

describe('التفاعل الهجين: لمس + كيبورد + ماسح', () => {
  it('المسح لا يفعّل حلقات الكيبورد ولا يستعيد التركيز، والسهم يعيدها فوراً', () => {
    const onScan = vi.fn();
    const keyboard = renderHook(() => usePosKeyboardActive());

    renderHook(() => usePosBarcodeScanner({
      onScan,
      onScannerActivity: () => {
        act(() => { keyboard.result.current.markScanner(); });
      },
    }));

    act(() => {
      keyboard.result.current.onPointerDown({ pointerType: 'touch' });
    });
    act(() => {
      keyboard.result.current.onKeyDown({ key: '6' });
      keyboard.result.current.onKeyDown({ key: '2' });
      keyboard.result.current.onKeyDown({ key: '8' });
    });
    scan('628');
    press('Enter');

    expect(onScan).toHaveBeenCalledWith('628');
    expect(keyboard.result.current.keyboardActive).toBe(false);
    expect(keyboard.result.current.lastInput).toBe('scanner');
    expect(shouldRestorePosFocus(keyboard.result.current.lastInput)).toBe(false);

    act(() => {
      keyboard.result.current.onKeyDown({ key: 'ArrowDown' });
    });
    expect(keyboard.result.current.keyboardActive).toBe(true);
    expect(keyboard.result.current.lastInput).toBe('keyboard');
    expect(shouldRestorePosFocus('keyboard')).toBe(true);
  });

  it('لا يغيّر خريطة الاختصارات', () => {
    expect(POS_SHORTCUT_BINDINGS.map(posShortcutBindingKey)).toEqual([
      'F2', 'F4', 'F6', 'F7', 'F8', 'F9',
      'ctrl+n', 'ctrl+alt+n', 'ctrl+shift+o', 'ctrl+alt+o', 'Escape',
    ]);
  });
});
