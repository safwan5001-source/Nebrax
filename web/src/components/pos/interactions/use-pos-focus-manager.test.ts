// @vitest-environment jsdom

import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { usePosFocusManager } from './use-pos-focus-manager';

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

function mountSearchInput(): HTMLInputElement {
  const input = document.createElement('input');
  document.body.appendChild(input);
  return input;
}

describe('مدير التركيز في نقطة البيع', () => {
  it('يركّز حقل البحث المسجَّل عند طلب صريح من المستخدم', () => {
    const { result } = renderHook(() => usePosFocusManager());
    const input = mountSearchInput();
    result.current.registerSearchInput(input);

    result.current.focusSearch();

    expect(document.activeElement).toBe(input);
  });

  it('لا ينكسر حين لا يكون حقل البحث معروضاً بعد', () => {
    const { result } = renderHook(() => usePosFocusManager());

    expect(() => result.current.focusSearch()).not.toThrow();
    expect(result.current.restoreSearchFocus()).toBe(false);
  });

  it('لا يسرق الاستعادة الآمنة التركيز من حقل يكتب فيه المستخدم', () => {
    const { result } = renderHook(() => usePosFocusManager());
    result.current.registerSearchInput(mountSearchInput());
    const note = document.createElement('textarea');
    document.body.appendChild(note);
    note.focus();

    expect(result.current.restoreSearchFocus()).toBe(false);
    expect(document.activeElement).toBe(note);
  });

  it('لا تسحب الاستعادة الآمنة التركيز من داخل حوار مفتوح', () => {
    const { result } = renderHook(() => usePosFocusManager());
    result.current.registerSearchInput(mountSearchInput());
    document.body.insertAdjacentHTML('beforeend', '<div role="dialog"><button type="button">تأكيد</button></div>');
    const dialogButton = document.querySelector('[role="dialog"] button') as HTMLButtonElement;
    dialogButton.focus();

    expect(result.current.restoreSearchFocus()).toBe(false);
    expect(document.activeElement).toBe(dialogButton);
  });

  it('يستعيد التركيز إلى البحث حين لا يكون التركيز في حقل ولا حوار', () => {
    const { result } = renderHook(() => usePosFocusManager());
    const input = mountSearchInput();
    result.current.registerSearchInput(input);

    expect(result.current.restoreSearchFocus()).toBe(true);
    expect(document.activeElement).toBe(input);
  });
});
