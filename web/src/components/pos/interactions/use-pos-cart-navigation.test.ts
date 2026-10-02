// @vitest-environment jsdom

import { cleanup, renderHook, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePosCartLineSelection, usePosCartNavigation } from './use-pos-cart-navigation';

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

function press(key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  window.dispatchEvent(event);
  return event;
}

describe('تنقل السلة بالكيبورد', () => {
  it('ينقل بين السطور ويعدّل الكمية', () => {
    const onSelectLineKey = vi.fn();
    const onAdjustQty = vi.fn();
    renderHook(() => usePosCartNavigation({
      enabled: true,
      step: 'sale',
      dialogOpen: false,
      activeZone: 'cart',
      lines: [{ key: 'a' }, { key: 'b' }],
      selectedLineKey: 'a',
      onSelectLineKey,
      onAdjustQty,
      onRemoveLine: vi.fn(),
      onEnterProductsZone: vi.fn(),
      focusManager: { focusZone: vi.fn() },
    }));

    press('ArrowDown');
    expect(onSelectLineKey).toHaveBeenCalledWith('b');

    press('+');
    expect(onAdjustQty).toHaveBeenCalledWith('a', 1);
  });

  it('Delete يستدعي مسار الحذف الرقابي لا حذفاً مباشراً', () => {
    const onRemoveLine = vi.fn();
    renderHook(() => usePosCartNavigation({
      enabled: true,
      step: 'sale',
      dialogOpen: false,
      activeZone: 'cart',
      lines: [{ key: 'line-1' }],
      selectedLineKey: 'line-1',
      onSelectLineKey: vi.fn(),
      onAdjustQty: vi.fn(),
      onRemoveLine,
      onEnterProductsZone: vi.fn(),
      focusManager: { focusZone: vi.fn() },
    }));

    press('Delete');
    expect(onRemoveLine).toHaveBeenCalledWith('line-1');
  });

  it('لا يعمل أثناء الدفع', () => {
    const onRemoveLine = vi.fn();
    renderHook(() => usePosCartNavigation({
      enabled: true,
      step: 'payment',
      dialogOpen: false,
      activeZone: 'cart',
      lines: [{ key: 'line-1' }],
      selectedLineKey: 'line-1',
      onSelectLineKey: vi.fn(),
      onAdjustQty: vi.fn(),
      onRemoveLine,
      onEnterProductsZone: vi.fn(),
      focusManager: { focusZone: vi.fn() },
    }));

    press('Delete');
    expect(onRemoveLine).not.toHaveBeenCalled();
  });
});

describe('تحديد سطر السلة بعد تبديل المفتاح', () => {
  it('يبقي المفتاح القديم إذا لم يعد ضمن الأسطر وswitchZoneToCart معطّل — لهذا يجب أن يحدّث setUnit المفتاح بنفسه', () => {
    const { result, rerender } = renderHook(
      ({ lines }: { lines: { key: string }[] }) => usePosCartLineSelection(lines, false),
      { initialProps: { lines: [{ key: 'p:-:piece' }] } },
    );
    expect(result.current.selectedLineKey).toBe('p:-:piece');

    rerender({ lines: [{ key: 'p:carton' }] });
    expect(result.current.selectedLineKey).toBe('p:-:piece');
  });

  it('يحفظ المفتاح الذي يمرّره المستدعي عندما يصبح هو سطر الدمج أو السطر المعاد تسميته', () => {
    const { result, rerender } = renderHook(
      ({ lines }: { lines: { key: string }[] }) => usePosCartLineSelection(lines, false),
      { initialProps: { lines: [{ key: 'p:-:piece' }, { key: 'p:-:carton' }] } },
    );
    expect(result.current.selectedLineKey).toBe('p:-:carton');

    act(() => result.current.setSelectedLineKey('p:-:piece'));
    rerender({ lines: [{ key: 'p:box' }, { key: 'p:-:carton' }] });
    expect(result.current.selectedLineKey).toBe('p:-:piece');

    act(() => result.current.setSelectedLineKey('p:-:carton'));
    rerender({ lines: [{ key: 'p:-:carton' }] });
    expect(result.current.selectedLineKey).toBe('p:-:carton');
  });
});
