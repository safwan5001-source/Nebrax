// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { confirmDiscardUnsaved, hasUnsavedChanges, setUnsavedOwner } from './unsaved-registry';

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
    expect(confirm).toHaveBeenLastCalledWith(expect.stringContaining('Switching store will discard'));
    document.documentElement.lang = 'ar';
    confirm.mockReturnValue(true);
    expect(confirmDiscardUnsaved()).toBe(true);
    expect(confirm).toHaveBeenLastCalledWith(expect.stringContaining('تبديل المتجر'));
  });
});
