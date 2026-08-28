// @vitest-environment jsdom

import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePosKeyboardShortcuts, type PosShortcutHandlers } from './use-pos-keyboard-shortcuts';

const closedDialogFlags = {
  pickerOpen: false,
  retrieveOpen: false,
  returnOpen: false,
  exchangeOpen: false,
  recentInvoicesOpen: false,
  openCartsOpen: false,
  clearCartOpen: false,
  noteOpen: false,
  sensitiveActionOpen: false,
  closeOpen: false,
  unsavedExitOpen: false,
  sessionGateOpen: false,
};

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

function press(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  window.dispatchEvent(event);
  return event;
}

function allHandlers() {
  return {
    customer: vi.fn(),
    search: vi.fn(),
    heldSales: vi.fn(),
    holdSale: vi.fn(),
    delete: vi.fn(),
    payment: vi.fn(),
    newCart: vi.fn(),
    openCarts: vi.fn(),
    back: vi.fn(),
  } satisfies Required<PosShortcutHandlers>;
}

describe('اختصارات لوحة المفاتيح في نقطة البيع', () => {
  it('يوجّه المفاتيح الوظيفية والاختصارات المركّبة', () => {
    const handlers = allHandlers();
    renderHook(() => usePosKeyboardShortcuts(handlers, { step: 'sale', dialogFlags: closedDialogFlags }));

    for (const [key, handler, init] of [
      ['F2', handlers.customer, {}],
      ['F4', handlers.search, {}],
      ['F6', handlers.heldSales, {}],
      ['F7', handlers.holdSale, {}],
      ['F8', handlers.delete, {}],
      ['F9', handlers.payment, {}],
      ['Escape', handlers.back, {}],
      ['n', handlers.newCart, { ctrlKey: true }],
      ['o', handlers.openCarts, { ctrlKey: true, shiftKey: true }],
    ] as const) {
      const event = press(key, init);
      expect(handler, key).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented, key).toBe(true);
    }
  });

  it('لا ينفّذ اختصارات البيع خلف حوار مفتوح', () => {
    const handlers = allHandlers();
    renderHook(() => usePosKeyboardShortcuts(handlers, {
      step: 'sale',
      dialogFlags: { ...closedDialogFlags, pickerOpen: true },
    }));

    press('F6');
    press('F9');

    expect(handlers.heldSales).not.toHaveBeenCalled();
    expect(handlers.payment).not.toHaveBeenCalled();
  });

  it('لا ينفّذ اختصارات السلة/المنتجات أثناء الدفع', () => {
    const handlers = allHandlers();
    renderHook(() => usePosKeyboardShortcuts(handlers, { step: 'payment', dialogFlags: closedDialogFlags }));

    press('F6');
    press('F8');
    const back = press('Escape');

    expect(handlers.heldSales).not.toHaveBeenCalled();
    expect(handlers.delete).not.toHaveBeenCalled();
    expect(handlers.back).toHaveBeenCalledTimes(1);
    expect(back.defaultPrevented).toBe(true);
  });

  it('يترك Esc بلا معالج لسلوكه الافتراضي خارج الدفع', () => {
    const handlers = allHandlers();
    renderHook(() => usePosKeyboardShortcuts({ ...handlers, back: undefined }, { step: 'sale', dialogFlags: closedDialogFlags }));

    const event = press('Escape');
    expect(handlers.back).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});
