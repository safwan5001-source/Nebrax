import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AWJ_THEMES,
  AWJ_THEME_ATTRIBUTE,
  AWJ_THEME_PRE_PAINT_SCRIPT,
  AWJ_THEME_STORAGE_KEY,
  applyAwjTheme,
  isAwjTheme,
  readAwjThemeAttribute,
  readAwjThemePreference,
  setAwjTheme,
  writeAwjThemePreference,
} from '../awj-theme';

// AWJ theme (Horizon 3) is a control axis independent from the v3 feature gate
// (data-awj-ui) and from Light/Dark (next-themes' .dark class) — THEMES.md §6. These
// tests pin that independence, the safe-fallback read, and the pre-paint script text
// staying byte-identical to what readAwjThemePreference/applyAwjTheme would do.

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute(AWJ_THEME_ATTRIBUTE);
  document.documentElement.removeAttribute('data-awj-ui');
});
afterEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute(AWJ_THEME_ATTRIBUTE);
  document.documentElement.removeAttribute('data-awj-ui');
});

describe('isAwjTheme', () => {
  it('accepts only the three closed values', () => {
    expect(AWJ_THEMES).toEqual(['default', 'ink', 'core']);
    expect(isAwjTheme('default')).toBe(true);
    expect(isAwjTheme('ink')).toBe(true);
    expect(isAwjTheme('core')).toBe(true);
    expect(isAwjTheme('Core')).toBe(false);
    expect(isAwjTheme('dark')).toBe(false);
    expect(isAwjTheme(null)).toBe(false);
    expect(isAwjTheme(undefined)).toBe(false);
    expect(isAwjTheme(3)).toBe(false);
  });
});

describe('readAwjThemePreference', () => {
  it('falls back to default when nothing is stored', () => {
    expect(readAwjThemePreference()).toBe('default');
  });

  it('reads a stored ink preference', () => {
    window.localStorage.setItem(AWJ_THEME_STORAGE_KEY, 'ink');
    expect(readAwjThemePreference()).toBe('ink');
  });

  it('reads a stored core preference', () => {
    window.localStorage.setItem(AWJ_THEME_STORAGE_KEY, 'core');
    expect(readAwjThemePreference()).toBe('core');
  });

  it('falls back to default on a corrupted stored value rather than throwing', () => {
    window.localStorage.setItem(AWJ_THEME_STORAGE_KEY, 'not-a-theme');
    expect(readAwjThemePreference()).toBe('default');
  });
});

describe('applyAwjTheme', () => {
  it('sets data-awj-theme="ink" for ink and nothing else', () => {
    applyAwjTheme('ink');
    expect(document.documentElement.getAttribute(AWJ_THEME_ATTRIBUTE)).toBe('ink');
  });

  it('sets data-awj-theme="core" for core', () => {
    applyAwjTheme('core');
    expect(document.documentElement.getAttribute(AWJ_THEME_ATTRIBUTE)).toBe('core');
  });

  it('switches between all three themes without leaving a stale value', () => {
    for (const theme of ['ink', 'core', 'ink', 'default', 'core'] as const) {
      applyAwjTheme(theme);
      expect(readAwjThemeAttribute()).toBe(theme);
      expect(document.documentElement.hasAttribute(AWJ_THEME_ATTRIBUTE)).toBe(theme !== 'default');
    }
  });

  it('removes the attribute for default (no "default" value written)', () => {
    applyAwjTheme('ink');
    applyAwjTheme('default');
    expect(document.documentElement.hasAttribute(AWJ_THEME_ATTRIBUTE)).toBe(false);
  });

  it('never touches data-awj-ui — theme and gate are independent axes', () => {
    applyAwjTheme('ink');
    expect(document.documentElement.hasAttribute('data-awj-ui')).toBe(false);

    document.documentElement.setAttribute('data-awj-ui', '3');
    applyAwjTheme('default');
    expect(document.documentElement.getAttribute('data-awj-ui')).toBe('3');
  });
});

describe('setAwjTheme', () => {
  it('persists to localStorage and applies the attribute together', () => {
    setAwjTheme('ink');
    expect(window.localStorage.getItem(AWJ_THEME_STORAGE_KEY)).toBe('ink');
    expect(document.documentElement.getAttribute(AWJ_THEME_ATTRIBUTE)).toBe('ink');

    setAwjTheme('core');
    expect(window.localStorage.getItem(AWJ_THEME_STORAGE_KEY)).toBe('core');
    expect(document.documentElement.getAttribute(AWJ_THEME_ATTRIBUTE)).toBe('core');
    expect(readAwjThemePreference()).toBe('core');

    setAwjTheme('default');
    expect(window.localStorage.getItem(AWJ_THEME_STORAGE_KEY)).toBe('default');
    expect(document.documentElement.hasAttribute(AWJ_THEME_ATTRIBUTE)).toBe(false);
  });
});

describe('writeAwjThemePreference safe fallback', () => {
  it('does not throw when localStorage access throws (private mode / blocked storage)', () => {
    const original = window.localStorage.setItem;
    window.localStorage.setItem = () => {
      throw new Error('storage blocked');
    };
    expect(() => writeAwjThemePreference('ink')).not.toThrow();
    window.localStorage.setItem = original;
  });
});

describe('AWJ_THEME_PRE_PAINT_SCRIPT', () => {
  it('reproduces applyAwjTheme("ink") when the stored key is "ink"', () => {
    window.localStorage.setItem(AWJ_THEME_STORAGE_KEY, 'ink');
    // eslint-disable-next-line no-new-func -- exercising the exact inline script string
    new Function(AWJ_THEME_PRE_PAINT_SCRIPT)();
    expect(document.documentElement.getAttribute(AWJ_THEME_ATTRIBUTE)).toBe('ink');
  });

  it('reproduces applyAwjTheme("core") when the stored key is "core"', () => {
    window.localStorage.setItem(AWJ_THEME_STORAGE_KEY, 'core');
    // eslint-disable-next-line no-new-func
    new Function(AWJ_THEME_PRE_PAINT_SCRIPT)();
    expect(document.documentElement.getAttribute(AWJ_THEME_ATTRIBUTE)).toBe('core');
  });

  it('does nothing (no attribute) for any other stored value, matching applyAwjTheme', () => {
    for (const stored of ['default', 'Core', 'neon', '']) {
      document.documentElement.removeAttribute(AWJ_THEME_ATTRIBUTE);
      window.localStorage.setItem(AWJ_THEME_STORAGE_KEY, stored);
      // eslint-disable-next-line no-new-func
      new Function(AWJ_THEME_PRE_PAINT_SCRIPT)();
      expect(document.documentElement.hasAttribute(AWJ_THEME_ATTRIBUTE)).toBe(false);
    }
  });

  it('agrees with applyAwjTheme for every closed theme value (no drift between the two)', () => {
    for (const theme of AWJ_THEMES) {
      document.documentElement.removeAttribute(AWJ_THEME_ATTRIBUTE);
      window.localStorage.setItem(AWJ_THEME_STORAGE_KEY, theme);
      // eslint-disable-next-line no-new-func
      new Function(AWJ_THEME_PRE_PAINT_SCRIPT)();
      const viaScript = document.documentElement.getAttribute(AWJ_THEME_ATTRIBUTE);
      document.documentElement.removeAttribute(AWJ_THEME_ATTRIBUTE);
      applyAwjTheme(theme);
      expect(viaScript).toBe(document.documentElement.getAttribute(AWJ_THEME_ATTRIBUTE));
    }
  });

  it('never throws when localStorage is unavailable', () => {
    const original = window.localStorage.getItem;
    window.localStorage.getItem = () => {
      throw new Error('blocked');
    };
    // eslint-disable-next-line no-new-func
    expect(() => new Function(AWJ_THEME_PRE_PAINT_SCRIPT)()).not.toThrow();
    window.localStorage.getItem = original;
  });

  it('references the real storage key and attribute name, not a hand-typed copy', () => {
    expect(AWJ_THEME_PRE_PAINT_SCRIPT).toContain(AWJ_THEME_STORAGE_KEY);
    expect(AWJ_THEME_PRE_PAINT_SCRIPT).toContain(AWJ_THEME_ATTRIBUTE);
  });
});
