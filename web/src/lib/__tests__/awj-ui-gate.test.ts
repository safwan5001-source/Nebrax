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

// ---- Horizon 5: rollout switch, precedence, pre-paint twin, route scope ----
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  AWJ_UI_EXCLUDED_PATH_PATTERN,
  buildAwjUiPrePaintScript,
  resolveAwjUiDefault,
} from '../awj-ui-gate';

function runPrePaint(script: string, pathname: string, search = '') {
  window.history.replaceState({}, '', `${pathname}${search}`);
  document.documentElement.removeAttribute('data-awj-ui');
  new Function(script)();
  return document.documentElement.getAttribute('data-awj-ui');
}

describe('rollout switch (NEXT_PUBLIC_AWJ_UI_DEFAULT)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-awj-ui');
    setLocation('');
  });

  it('is off unless the build value is exactly "3"', () => {
    expect(resolveAwjUiDefault(undefined)).toBeNull();
    expect(resolveAwjUiDefault('')).toBeNull();
    expect(resolveAwjUiDefault('true')).toBeNull();
    expect(resolveAwjUiDefault('3')).toBe('3');
  });

  it('a default-on build gives v3 when the browser has made no choice', () => {
    expect(readAwjUiPreference('3')).toBe('3');
  });

  it('?awj-ui=legacy is remembered on a default-on build (so the opt-out survives navigation)', () => {
    setLocation('?awj-ui=legacy');
    expect(readAwjUiPreference('3')).toBeNull();
    expect(window.localStorage.getItem(AWJ_UI_STORAGE_KEY)).toBe('legacy');
    setLocation('');
    expect(readAwjUiPreference('3')).toBeNull();
  });

  it('?awj-ui=3 re-opts-in after an opt-out', () => {
    window.localStorage.setItem(AWJ_UI_STORAGE_KEY, 'legacy');
    setLocation('?awj-ui=3');
    expect(readAwjUiPreference('3')).toBe('3');
  });

  it('a stored "legacy" never turns v3 on when the default is off (rollback state is stable)', () => {
    window.localStorage.setItem(AWJ_UI_STORAGE_KEY, 'legacy');
    expect(readAwjUiPreference(null)).toBeNull();
  });

  it('rollback loses no theme / mode preference: the gate never touches their keys', () => {
    window.localStorage.setItem('awj:theme', 'ink');
    window.localStorage.setItem('theme', 'dark');
    setLocation('?awj-ui=legacy');
    readAwjUiPreference('3');
    expect(window.localStorage.getItem('awj:theme')).toBe('ink');
    expect(window.localStorage.getItem('theme')).toBe('dark');
  });
});

describe('pre-paint twin', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-awj-ui');
  });

  it('is inert with the default off and no stored choice', () => {
    expect(runPrePaint(buildAwjUiPrePaintScript(null), '/dashboard')).toBeNull();
  });

  it('applies v3 before paint for a stored opt-in', () => {
    window.localStorage.setItem(AWJ_UI_STORAGE_KEY, '3');
    expect(runPrePaint(buildAwjUiPrePaintScript(null), '/dashboard')).toBe('3');
  });

  it('applies v3 for a default-on build, unless the browser opted out', () => {
    const script = buildAwjUiPrePaintScript('3');
    expect(runPrePaint(script, '/dashboard')).toBe('3');
    window.localStorage.setItem(AWJ_UI_STORAGE_KEY, 'legacy');
    expect(runPrePaint(script, '/dashboard')).toBeNull();
    expect(runPrePaint(script, '/dashboard', '?awj-ui=3')).toBe('3');
  });

  it('never applies on the excluded (non-workspace) paths', () => {
    window.localStorage.setItem(AWJ_UI_STORAGE_KEY, '3');
    const script = buildAwjUiPrePaintScript('3');
    for (const p of ['/', '/login', '/register', '/platform/tenants', '/fuel-stations/sales', '/auth/handoff']) {
      expect(runPrePaint(script, p), p).toBeNull();
    }
  });

  it('matches the route groups: every top-level app segment is excluded or belongs to a gate-applying group', () => {
    const appDir = path.resolve(__dirname, '../../app');
    const excluded = new RegExp(AWJ_UI_EXCLUDED_PATH_PATTERN);
    const groupsThatApplyGate = new Set(['(app)', '(commerce)', '(pos)']);
    for (const entry of readdirSync(appDir)) {
      const full = path.join(appDir, entry);
      if (!statSync(full).isDirectory()) continue;
      if (entry.startsWith('(')) {
        if (entry === '(fuel)') continue; // deliberately not gated — covered by '/fuel-stations'
        expect(groupsThatApplyGate.has(entry), `route group ${entry} must be reviewed for the gate`).toBe(true);
        continue;
      }
      expect(excluded.test(`/${entry}`), `top-level route /${entry} is outside every gate-applying group and must be excluded from the pre-paint`).toBe(true);
    }
  });
});
