// @vitest-environment jsdom

import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePosProductNavigation, usePosSearchFieldNavigation } from './use-pos-product-navigation';

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

function press(key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  window.dispatchEvent(event);
  return event;
}

describe('تنقل المنتجات بالكيبoard', () => {
  it('Enter يضيف المنتج المحدد', () => {
    const onAddProduct = vi.fn();
    renderHook(() => usePosProductNavigation({
      enabled: true,
      rtl: false,
      step: 'sale',
      dialogOpen: false,
      activeZone: 'products',
      products: [{ id: 'p1' }, { id: 'p2' }],
      getProductElement: () => null,
      onSelectIndex: vi.fn(),
      selectedIndex: 1,
      onAddProduct,
      onEnterCartZone: vi.fn(),
      focusManager: { focusZone: vi.fn() },
    }));

    press('Enter');
    expect(onAddProduct).toHaveBeenCalledWith({ id: 'p2' });
  });

  it('ArrowDown من البحث ينقل لأول منتج', () => {
    const onMoveToProducts = vi.fn();
    const { result } = renderHook(() => usePosSearchFieldNavigation({
      onMoveToProducts,
      onExitSearch: vi.fn(),
    }));
    const input = document.createElement('input');
    const preventDefault = vi.fn();
    result.current({
      key: 'ArrowDown',
      preventDefault,
      currentTarget: input,
    } as unknown as React.KeyboardEvent<HTMLInputElement>);
    expect(onMoveToProducts).toHaveBeenCalled();
    expect(preventDefault).toHaveBeenCalled();
  });
});
