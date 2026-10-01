import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  AWJ_UI_STORAGE_KEY,
  applyAwjUiGate,
  readAwjUiPreference,
} from '../awj-ui-gate';

// This file needs a browser-like global (window/document/localStorage). It is listed
// in vitest.config.ts's environmentMatchGlobs so it runs under jsdom.

function setLocation(search: string) {
  window.history.replaceState({}, '', `/dashboard${search}`);
}

describe('awj-ui-gate', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-awj-ui');
    setLocation('');
  });

  afterEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-awj-ui');
  });

  it('defaults to no preference (gate OFF) with nothing stored and no query param', () => {
    expect(readAwjUiPreference()).toBeNull();
  });

  it('opts in via ?awj-ui=3 and persists it to localStorage', () => {
    setLocation('?awj-ui=3');
    expect(readAwjUiPreference()).toBe('3');
    expect(window.localStorage.getItem(AWJ_UI_STORAGE_KEY)).toBe('3');
  });

  it('remembers the opt-in on a later navigation with no query param', () => {
    setLocation('?awj-ui=3');
    readAwjUiPreference();
    setLocation('');
    expect(readAwjUiPreference()).toBe('3');
  });

  it('opts back out via ?awj-ui=legacy and clears the stored preference', () => {
    window.localStorage.setItem(AWJ_UI_STORAGE_KEY, '3');
    setLocation('?awj-ui=legacy');
    expect(readAwjUiPreference()).toBeNull();
    expect(window.localStorage.getItem(AWJ_UI_STORAGE_KEY)).toBeNull();
  });

  it('applyAwjUiGate sets the attribute only when opted in, and the returned cleanup always removes it', () => {
    setLocation('?awj-ui=3');
    const cleanup = applyAwjUiGate();
    expect(document.documentElement.getAttribute('data-awj-ui')).toBe('3');
    cleanup();
    expect(document.documentElement.hasAttribute('data-awj-ui')).toBe(false);
  });

  it('applyAwjUiGate removes any stale attribute when there is no opt-in', () => {
    document.documentElement.setAttribute('data-awj-ui', '3');
    applyAwjUiGate();
    expect(document.documentElement.hasAttribute('data-awj-ui')).toBe(false);
  });
});
