// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { confirmDiscardUnsaved, hasUnsavedChanges, installUnsavedNavigationGuard, setUnsavedOwner } from './unsaved-registry';

const owner = Symbol('a');
const other = Symbol('b');
afterEach(() => {
  setUnsavedOwner(owner, false);
  setUnsavedOwner(other, false);
  vi.restoreAllMocks();
});

describe('unsaved registry', () => {
  it('is dirty while any owner is dirty and clean once all are saved or unmounted', () => {
    expect(hasUnsavedChanges()).toBe(false);
    setUnsavedOwner(owner, true);
    setUnsavedOwner(other, true);
    setUnsavedOwner(owner, false);
    expect(hasUnsavedChanges()).toBe(true);
    setUnsavedOwner(other, false);
    expect(hasUnsavedChanges()).toBe(false);
  });

  it('asks nothing when clean, and asks in the page language when dirty', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    expect(confirmDiscardUnsaved()).toBe(true);
    expect(confirm).not.toHaveBeenCalled();

    setUnsavedOwner(owner, true);
    document.documentElement.lang = 'en';
    expect(confirmDiscardUnsaved()).toBe(false);
    expect(confirm).toHaveBeenLastCalledWith(expect.stringContaining('Continuing will discard'));
    document.documentElement.lang = 'ar';
    confirm.mockReturnValue(true);
    expect(confirmDiscardUnsaved()).toBe(true);
    expect(confirm).toHaveBeenLastCalledWith(expect.stringContaining('المتابعة ستُسقطها'));
  });
});

describe('unsaved navigation guard', () => {
  const link = (href: string, attrs: Record<string, string> = {}) => {
    const a = document.createElement('a');
    a.href = href;
    for (const [k, v] of Object.entries(attrs)) a.setAttribute(k, v);
    document.body.appendChild(a);

    return a;
  };
  const click = (a: HTMLElement, init: MouseEventInit = {}) => {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init });
    a.dispatchEvent(event);

    return event.defaultPrevented;
  };

  it('cancels an in-app link when the merchant declines, lets it through when confirmed, and ignores clean state', () => {
    const remove = installUnsavedNavigationGuard();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const a = link('/commerce/gifting');

    expect(click(a)).toBe(false); // نظيف: لا سؤال
    expect(confirm).not.toHaveBeenCalled();

    setUnsavedOwner(owner, true);
    expect(click(a)).toBe(true);
    confirm.mockReturnValue(true);
    expect(click(a)).toBe(false);
    remove();
    a.remove();
  });

  it('ignores modified clicks, new-tab/download/external/hash links and the current page', () => {
    const remove = installUnsavedNavigationGuard();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    setUnsavedOwner(owner, true);

    for (const a of [link('/x', { target: '_blank' }), link('/x', { download: '' }), link('https://example.com/x'), link(`${window.location.pathname}${window.location.search}#top`)]) {
      expect(click(a)).toBe(false);
      a.remove();
    }
    const plain = link('/x');
    expect(click(plain, { ctrlKey: true })).toBe(false);
    expect(click(plain, { button: 1 })).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
    remove();
    plain.remove();
  });

  it('stops guarding once removed', () => {
    const remove = installUnsavedNavigationGuard();
    remove();
    setUnsavedOwner(owner, true);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const a = link('/commerce/gifting');
    expect(click(a)).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
    a.remove();
  });
});
