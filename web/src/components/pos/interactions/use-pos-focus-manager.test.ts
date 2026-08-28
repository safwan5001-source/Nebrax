// @vitest-environment jsdom

import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { shouldRestorePosFocus } from './use-pos-keyboard-active';
import { usePosFocusManager } from './use-pos-focus-manager';

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('مدير التركيز في نقطة البيع', () => {
  it('يركّز مناطق البحث والمنتجات والسلة', () => {
    const { result } = renderHook(() => usePosFocusManager());
    const search = document.createElement('input');
    const product = document.createElement('button');
    const cartLine = document.createElement('div');
    cartLine.tabIndex = -1;
    document.body.append(search, product, cartLine);

    result.current.registerSearchInput(search);
    result.current.registerProductButton(0, product);
    result.current.registerCartLine('line-a', cartLine);

    result.current.focusZone('search');
    expect(document.activeElement).toBe(search);

    result.current.focusZone('products', { productIndex: 0 });
    expect(document.activeElement).toBe(product);

    result.current.focusZone('cart', { cartLineKey: 'line-a' });
    expect(document.activeElement).toBe(cartLine);
  });

  it('لا يسرق restoreFocusSafe التركيز من حوار أو حقل', () => {
    const { result } = renderHook(() => usePosFocusManager());
    const search = document.createElement('input');
    document.body.appendChild(search);
    result.current.registerSearchInput(search);

    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    textarea.focus();
    expect(result.current.restoreFocusSafe()).toBe(false);

    document.body.insertAdjacentHTML('beforeend', '<div role="dialog"><button type="button">ok</button></div>');
    const dialogButton = document.querySelector('[role="dialog"] button') as HTMLButtonElement;
    dialogButton.focus();
    expect(result.current.restoreFocusSafe()).toBe(false);
  });

  it('لا يُفرض تركيز البحث بعد تفاعل pointer عندما تُحرس الاستعادة', () => {
    const { result } = renderHook(() => usePosFocusManager());
    const search = document.createElement('input');
    const product = document.createElement('button');
    document.body.append(search, product);
    result.current.registerSearchInput(search);
    result.current.registerProductButton(0, product);
    result.current.focusZone('products', { productIndex: 0 });

    expect(shouldRestorePosFocus('pointer')).toBe(false);
    expect(document.activeElement).toBe(product);
    expect(search).not.toBe(document.activeElement);
  });
});
