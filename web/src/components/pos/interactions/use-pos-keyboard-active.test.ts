// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { shouldRestorePosFocus, usePosKeyboardActive } from './use-pos-keyboard-active';

afterEach(() => cleanup());

describe('usePosKeyboardActive', () => {
  it('يطفي حلقات التحديد عند pointer ويحفظ نوع المؤشر', () => {
    const { result } = renderHook(() => usePosKeyboardActive());
    expect(result.current.keyboardActive).toBe(false);
    expect(result.current.lastInput).toBe('keyboard');

    act(() => {
      result.current.onKeyDown();
    });
    expect(result.current.keyboardActive).toBe(true);
    expect(result.current.lastInput).toBe('keyboard');
    expect(result.current.isPointerSession).toBe(false);

    act(() => {
      result.current.onPointerDown({ pointerType: 'touch' });
    });
    expect(result.current.keyboardActive).toBe(false);
    expect(result.current.lastInput).toBe('pointer');
    expect(result.current.pointerType).toBe('touch');
    expect(result.current.isPointerSession).toBe(true);
  });

  it('يعيد Keyboard Power Mode فور أول keydown بعد اللمس', () => {
    const { result } = renderHook(() => usePosKeyboardActive());

    act(() => {
      result.current.onPointerDown({ pointerType: 'touch' });
    });
    act(() => {
      result.current.onKeyDown();
    });

    expect(result.current.keyboardActive).toBe(true);
    expect(result.current.lastInput).toBe('keyboard');
    expect(result.current.isPointerSession).toBe(false);
  });

  it('يميز الماوس والقلم كـ pointer دون تصنيف جهاز دائم', () => {
    const { result } = renderHook(() => usePosKeyboardActive());

    act(() => {
      result.current.onPointerDown({ pointerType: 'mouse' });
    });
    expect(result.current.pointerType).toBe('mouse');
    expect(result.current.isPointerSession).toBe(true);

    act(() => {
      result.current.onPointerDown({ pointerType: 'pen' });
    });
    expect(result.current.pointerType).toBe('pen');
    expect(result.current.lastInput).toBe('pointer');
  });
});

describe('shouldRestorePosFocus', () => {
  it('يمنع استعادة التركيز بعد جلسة pointer ويسمح بها بعد الكيبورد', () => {
    expect(shouldRestorePosFocus('pointer')).toBe(false);
    expect(shouldRestorePosFocus('keyboard')).toBe(true);
  });
});
