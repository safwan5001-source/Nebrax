// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { StrictMode, useEffect, type ReactNode } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LandingTheme } from '@/components/landing/landing-theme';
import { LANDING_PREV_KEY, LANDING_THEME_PRE_PAINT_SCRIPT } from '@/components/landing/landing-theme-script';
import { AWJ_THEME_ATTRIBUTE, AWJ_THEME_STORAGE_KEY } from '@/lib/awj-theme';
import { AWJ_UI_STORAGE_KEY, applyAwjUiGate } from '@/lib/awj-ui-gate';

const root = document.documentElement;
const src = resolve(__dirname, '..');
const read = (rel: string) => readFileSync(resolve(src, rel), 'utf8');

function reset() {
  root.removeAttribute('data-awj-ui');
  root.removeAttribute(AWJ_THEME_ATTRIBUTE);
  delete (window as unknown as Record<string, unknown>)[LANDING_PREV_KEY];
  window.localStorage.clear();
}

beforeEach(reset);
afterEach(() => {
  cleanup();
  reset();
});

describe('landing page adopts AWJ Core through the shared theme attributes', () => {
  it('applies the shared v3 gate and the core theme while mounted, and removes them on leave', () => {
    const { unmount } = render(<LandingTheme />);
    expect(root.getAttribute('data-awj-ui')).toBe('3');
    expect(root.getAttribute(AWJ_THEME_ATTRIBUTE)).toBe('core');
    unmount();
    expect(root.hasAttribute('data-awj-ui')).toBe(false);
    expect(root.hasAttribute(AWJ_THEME_ATTRIBUTE)).toBe(false);
  });

  it("gives back the visitor's own theme on leave and leaves the gate to whichever route wants it", () => {
    root.setAttribute(AWJ_THEME_ATTRIBUTE, 'ink');
    root.setAttribute('data-awj-ui', '3');
    const { unmount } = render(<LandingTheme />);
    expect(root.getAttribute(AWJ_THEME_ATTRIBUTE)).toBe('core');
    unmount();
    expect(root.getAttribute(AWJ_THEME_ATTRIBUTE)).toBe('ink');
    expect(root.hasAttribute('data-awj-ui')).toBe(false);
  });

  it('never writes the theme or gate preference to storage', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const { unmount } = render(<LandingTheme />);
    unmount();
    expect(setItem).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(AWJ_THEME_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(AWJ_UI_STORAGE_KEY)).toBeNull();
    setItem.mockRestore();
  });

  it('survives React strict-mode double mounting without leaking the landing theme', () => {
    root.setAttribute(AWJ_THEME_ATTRIBUTE, 'ink');
    const { unmount } = render(
      <StrictMode>
        <LandingTheme />
      </StrictMode>
    );
    expect(root.getAttribute(AWJ_THEME_ATTRIBUTE)).toBe('core');
    unmount();
    expect(root.getAttribute(AWJ_THEME_ATTRIBUTE)).toBe('ink');
    expect(root.hasAttribute('data-awj-ui')).toBe(false);
  });

  it('restores the pre-paint snapshot when the inline script ran before React', () => {
    root.setAttribute(AWJ_THEME_ATTRIBUTE, 'ink');
    new Function(LANDING_THEME_PRE_PAINT_SCRIPT)();
    expect(root.getAttribute('data-awj-ui')).toBe('3');
    expect(root.getAttribute(AWJ_THEME_ATTRIBUTE)).toBe('core');
    const { unmount } = render(<LandingTheme />);
    unmount();
    expect(root.getAttribute(AWJ_THEME_ATTRIBUTE)).toBe('ink');
    expect(root.hasAttribute('data-awj-ui')).toBe(false);
  });
});

/** A workspace route group: mounts the gate in a passive effect and removes it on unmount, exactly like `(app)/layout.tsx`. */
function Workspace() {
  useEffect(() => applyAwjUiGate(), []);
  return <main data-testid="workspace" />;
}

function Route({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

describe('client-side navigation between the workspace and the landing page', () => {
  const workspaceUser = () => {
    window.localStorage.setItem(AWJ_UI_STORAGE_KEY, '3');
    root.setAttribute(AWJ_THEME_ATTRIBUTE, 'ink');
  };

  it('keeps the gate and Core when the landing replaces a workspace route (outgoing cleanup runs after the landing layout effect)', () => {
    workspaceUser();
    const view = render(<Route><Workspace /></Route>);
    expect(root.getAttribute('data-awj-ui')).toBe('3');
    act(() => view.rerender(<Route><LandingTheme /></Route>));
    expect(root.getAttribute('data-awj-ui')).toBe('3');
    expect(root.getAttribute(AWJ_THEME_ATTRIBUTE)).toBe('core');
  });

  it('puts the workspace settings back when the visitor returns to the workspace', () => {
    workspaceUser();
    const view = render(<Route><Workspace /></Route>);
    act(() => view.rerender(<Route><LandingTheme /></Route>));
    act(() => view.rerender(<Route><Workspace /></Route>));
    expect(root.getAttribute('data-awj-ui')).toBe('3');
    expect(root.getAttribute(AWJ_THEME_ATTRIBUTE)).toBe('ink');
  });

  it('does not leak the gate to a non-workspace page reached from the landing page', () => {
    workspaceUser();
    const view = render(<Route><Workspace /></Route>);
    act(() => view.rerender(<Route><LandingTheme /></Route>));
    act(() => view.rerender(<Route><main /></Route>));
    expect(root.hasAttribute('data-awj-ui')).toBe(false);
    expect(root.getAttribute(AWJ_THEME_ATTRIBUTE)).toBe('ink');
  });

  it('holds under strict mode (effects run, clean up and run again)', () => {
    workspaceUser();
    const view = render(
      <StrictMode>
        <Route><Workspace /></Route>
      </StrictMode>
    );
    act(() =>
      view.rerender(
        <StrictMode>
          <Route><LandingTheme /></Route>
        </StrictMode>
      )
    );
    expect(root.getAttribute('data-awj-ui')).toBe('3');
    expect(root.getAttribute(AWJ_THEME_ATTRIBUTE)).toBe('core');
    act(() =>
      view.rerender(
        <StrictMode>
          <Route><Workspace /></Route>
        </StrictMode>
      )
    );
    expect(root.getAttribute('data-awj-ui')).toBe('3');
    expect(root.getAttribute(AWJ_THEME_ATTRIBUTE)).toBe('ink');
  });
});

describe('landing page stays on the shared theme system', () => {
  const css = read('app/landing.css');
  const page = read('app/page.tsx');

  it('has no literal colours: every colour is a token', () => {
    const body = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(body).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(body).not.toMatch(/\b(?:rgba?|hsla?|hwb|lab|lch)\(/);
  });

  it('reads Core from the shared shell tokens and does not declare a theme of its own', () => {
    expect(css).toContain('var(--awj-shell-bg');
    expect(css).toContain('var(--awj-shell-fg');
    expect(css).not.toMatch(/data-awj-theme/);
    expect(css).not.toMatch(/--awj-shell-[a-z-]+\s*:/);
  });

  it('offers no way to pick another theme on the page', () => {
    for (const file of [page, read('components/landing/landing-nav.tsx'), read('components/landing/module-tabs.tsx')]) {
      expect(file).not.toMatch(/setAwjTheme|AccountPreferencesCard|useAwjTheme|AWJ_THEMES/);
    }
  });
});
