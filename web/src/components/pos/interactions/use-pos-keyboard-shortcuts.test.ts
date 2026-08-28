// @vitest-environment jsdom

import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePosKeyboardShortcuts, type PosShortcutHandlers } from './use-pos-keyboard-shortcuts';

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

function press(key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  window.dispatchEvent(event);
  return event;
}

function allHandlers() {
  return {
    customer: vi.fn(),
    search: vi.fn(),
    delete: vi.fn(),
    payment: vi.fn(),
    back: vi.fn(),
  } satisfies Required<PosShortcutHandlers>;
}

function focusEditable(tag: 'input' | 'textarea'): HTMLElement {
  const element = document.createElement(tag);
  document.body.appendChild(element);
  element.focus();
  return element;
}

describe('اختصارات لوحة المفاتيح في نقطة البيع', () => {
  it('يوجّه كل مفتاح قائم إلى معالجه ويمنع سلوكه الافتراضي', () => {
    const handlers = allHandlers();
    renderHook(() => usePosKeyboardShortcuts(handlers));

    for (const [key, handler] of [
      ['F2', handlers.customer],
      ['F4', handlers.search],
      ['F8', handlers.delete],
      ['F9', handlers.payment],
      ['Escape', handlers.back],
    ] as const) {
      const event = press(key);
      expect(handler, key).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented, key).toBe(true);
    }
  });

  it('لا يحذف F8 سطراً بينما يكتب المستخدم داخل حقل', () => {
    const handlers = allHandlers();
    renderHook(() => usePosKeyboardShortcuts(handlers));
    focusEditable('textarea');

    const event = press('F8');

    expect(handlers.delete).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('يبقى فتح العميل والبحث والدفع عاملاً ولو كان التركيز داخل حقل', () => {
    const handlers = allHandlers();
    renderHook(() => usePosKeyboardShortcuts(handlers));
    focusEditable('input');

    press('F2');
    press('F4');
    press('F9');

    expect(handlers.customer).toHaveBeenCalledTimes(1);
    expect(handlers.search).toHaveBeenCalledTimes(1);
    expect(handlers.payment).toHaveBeenCalledTimes(1);
  });

  it('يترك المفتاح بلا معالج لسلوكه الافتراضي — Esc خارج شاشة الدفع يغلق الحوارات', () => {
    const handlers = allHandlers();
    renderHook(() => usePosKeyboardShortcuts({ ...handlers, back: undefined }));

    const event = press('Escape');

    expect(handlers.back).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('لا يعترض مفتاحاً خارج السجل', () => {
    const handlers = allHandlers();
    renderHook(() => usePosKeyboardShortcuts(handlers));

    const event = press('F5');

    expect(event.defaultPrevented).toBe(false);
    for (const handler of Object.values(handlers)) expect(handler).not.toHaveBeenCalled();
  });

  it('يستدعي أحدث المعالجات بعد إعادة الرسم لا نسخة وقت التركيب', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ payment }) => usePosKeyboardShortcuts({ payment }), {
      initialProps: { payment: first },
    });

    rerender({ payment: second });
    press('F9');

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('ينظّف المستمع عند إزالة الشاشة', () => {
    const handlers = allHandlers();
    const { unmount } = renderHook(() => usePosKeyboardShortcuts(handlers));

    unmount();
    const event = press('F9');

    expect(handlers.payment).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});
