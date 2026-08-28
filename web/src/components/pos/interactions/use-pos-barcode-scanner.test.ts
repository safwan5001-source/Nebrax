// @vitest-environment jsdom

import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePosBarcodeScanner } from './use-pos-barcode-scanner';

beforeEach(() => { vi.useFakeTimers(); });

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  document.body.innerHTML = '';
});

/** ضغطة مفتاح على النافذة تماماً كما يرسلها الماسح أو المستخدم. */
function press(key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  window.dispatchEvent(event);
  return event;
}

/** تسلسل ماسح: أحرف متتابعة بفجوة أقصر من عتبة الفصل. */
function scan(code: string, gapMs = 10): void {
  for (const character of code) {
    press(character);
    vi.advanceTimersByTime(gapMs);
  }
}

function focusInput(): HTMLInputElement {
  const input = document.createElement('input');
  document.body.appendChild(input);
  input.focus();
  return input;
}

describe('ماسح الباركود في نقطة البيع', () => {
  it('يستدعي المسح مرة واحدة بالكود الصحيح عند تسلسل سريع ثم Enter', () => {
    const onScan = vi.fn();
    renderHook(() => usePosBarcodeScanner({ onScan }));

    scan('6281000012345');
    const enter = press('Enter');

    expect(onScan).toHaveBeenCalledTimes(1);
    expect(onScan).toHaveBeenCalledWith('6281000012345');
    expect(enter.defaultPrevented).toBe(true);
  });

  it('لا يلتقط الكتابة داخل حقل مركَّز فتبقى الكتابة اليدوية طبيعية', () => {
    const onScan = vi.fn();
    renderHook(() => usePosBarcodeScanner({ onScan }));
    focusInput();

    scan('6281000012345');
    const enter = press('Enter');

    expect(onScan).not.toHaveBeenCalled();
    expect(enter.defaultPrevented).toBe(false);
  });

  it('لا ينتج باركوداً خاطئاً من كتابة بشرية بطيئة خارج الحقول', () => {
    const onScan = vi.fn();
    renderHook(() => usePosBarcodeScanner({ onScan }));

    scan('123', 200);
    const enter = press('Enter');

    expect(onScan).not.toHaveBeenCalled();
    expect(enter.defaultPrevented).toBe(false);
  });

  it('يُفرغ المخزن بعد تجاوز فجوة الفصل فلا يلتحم مسحان في كود واحد', () => {
    const onScan = vi.fn();
    renderHook(() => usePosBarcodeScanner({ onScan }));

    scan('123');
    vi.advanceTimersByTime(500);
    scan('456');
    press('Enter');

    expect(onScan).toHaveBeenCalledTimes(1);
    expect(onScan).toHaveBeenCalledWith('456');
  });

  it('يُفرغ المخزن عند Enter فلا يحمل مسحٌ بقايا سابقه', () => {
    const onScan = vi.fn();
    renderHook(() => usePosBarcodeScanner({ onScan }));

    scan('123');
    press('Enter');
    scan('456');
    press('Enter');

    expect(onScan).toHaveBeenNthCalledWith(1, '123');
    expect(onScan).toHaveBeenNthCalledWith(2, '456');
  });

  it('لا تدخل المفاتيح الوظيفية مخزن المسح فلا تفسد الاختصارات كوداً جارياً', () => {
    const onScan = vi.fn();
    renderHook(() => usePosBarcodeScanner({ onScan }));

    press('F9');
    scan('12');
    press('F4');
    scan('3');
    press('Enter');

    expect(onScan).toHaveBeenCalledWith('123');
  });

  it('ينظّف المستمع عند إزالة الشاشة فلا يبقى مسح معلّق بعدها', () => {
    const onScan = vi.fn();
    const { unmount } = renderHook(() => usePosBarcodeScanner({ onScan }));

    unmount();
    scan('6281000012345');
    press('Enter');

    expect(onScan).not.toHaveBeenCalled();
  });

  it('يستدعي أحدث callback لا نسخته وقت التركيب', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ onScan }) => usePosBarcodeScanner({ onScan }), {
      initialProps: { onScan: first as (code: string) => unknown },
    });

    rerender({ onScan: second as (code: string) => unknown });
    scan('123');
    press('Enter');

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith('123');
  });

  it('لا يلتقط مسحاً عندما يكون معطّلاً (دفع/حوار)', () => {
    const onScan = vi.fn();
    renderHook(() => usePosBarcodeScanner({ onScan, enabled: false }));

    scan('6281000012345');
    press('Enter');

    expect(onScan).not.toHaveBeenCalled();
  });
});
