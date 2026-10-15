// AWJ v3 theme selection (Horizon 3) — Default / Ink / Core.
//
// This is deliberately a SEPARATE control axis from the v3 feature gate
// (`awj-ui-gate.ts`, `data-awj-ui="3"`) and from Light/Dark mode (next-themes,
// `.dark` class): THEMES.md §6 — "محورا تحكّم مستقلان — لا دمج في محوّل واحد."
// Reading or writing a theme preference never touches `data-awj-ui`, so it can
// never accidentally opt a browser into v3.
//
// Storage: the `AWJ_THEME_STORAGE_KEY` localStorage key is the fast, synchronous
// source pre-paint relies on (see the inline script in app/layout.tsx). The signed-in
// user's server-side preference (`AuthUser.preferences.appTheme`, persisted via
// PUT /account/preferences — an existing JSON preferences column, no migration) is the
// durable, cross-device source; AccountPreferencesCard syncs it into localStorage on
// load so the next pre-paint picks it up even before the API call resolves.
//
// `data-awj-theme="ink" | "core"` only has a visible effect once `data-awj-ui="3"` is also
// present (every theme CSS rule is additionally gated — see globals.css); setting it
// with the gate off is inert, matching the "theme vs gate are separate concerns" rule.

/** The closed theme list. `default` is the absence of the attribute; every other value is
 * written to `html[data-awj-theme]`. Keep in sync with the backend allow-list
 * (UpdateAccountPreferencesRequest) and the generated CSS selectors (awj.tokens.json). */
export const AWJ_THEMES = ['default', 'ink', 'core'] as const;
export type AwjTheme = (typeof AWJ_THEMES)[number];

export const AWJ_THEME_STORAGE_KEY = 'awj:theme';
export const AWJ_THEME_ATTRIBUTE = 'data-awj-theme';

export function isAwjTheme(value: unknown): value is AwjTheme {
  return typeof value === 'string' && (AWJ_THEMES as readonly string[]).includes(value);
}

/** Safe-fallback read: anything but a recognized value (missing, corrupted, blocked
 * storage access) resolves to 'default', never throws. */
export function readAwjThemePreference(): AwjTheme {
  if (typeof window === 'undefined') return 'default';
  try {
    const stored = window.localStorage.getItem(AWJ_THEME_STORAGE_KEY);
    return isAwjTheme(stored) ? stored : 'default';
  } catch {
    return 'default';
  }
}

export function writeAwjThemePreference(theme: AwjTheme): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(AWJ_THEME_STORAGE_KEY, theme);
  } catch {
    // Storage blocked (private mode, quota) — the in-memory attribute still applies
    // for this page load; only persistence across reloads is lost.
  }
}

/** Current theme as carried by `html[data-awj-theme]`; anything unrecognized is 'default'. */
export function readAwjThemeAttribute(): AwjTheme {
  if (typeof document === 'undefined') return 'default';
  const attr = document.documentElement.getAttribute(AWJ_THEME_ATTRIBUTE);
  return isAwjTheme(attr) ? attr : 'default';
}

/** Sets (or clears, for 'default') the attribute on <html>. Never touches
 * `data-awj-ui`. Safe to call unconditionally — a no-op when SSR'd. */
export function applyAwjTheme(theme: AwjTheme): void {
  if (typeof document === 'undefined') return;
  if (theme !== 'default' && isAwjTheme(theme)) {
    document.documentElement.setAttribute(AWJ_THEME_ATTRIBUTE, theme);
  } else {
    document.documentElement.removeAttribute(AWJ_THEME_ATTRIBUTE);
  }
}

export function setAwjTheme(theme: AwjTheme): void {
  writeAwjThemePreference(theme);
  applyAwjTheme(theme);
}

const PRE_PAINT_THEMES = AWJ_THEMES.filter((theme) => theme !== 'default');

/**
 * Source for the pre-paint inline script in app/layout.tsx — kept as a plain string
 * (not imported at runtime) so it can be inlined into a <script> tag that executes
 * before first paint, before any React/bundle code runs. Mirrors readAwjThemePreference
 * + applyAwjTheme exactly; keep the two in sync if either changes.
 *
 * Deliberately tiny, synchronous, no network access, wrapped in try/catch so a blocked
 * or throwing localStorage (private browsing, disabled storage) degrades silently to
 * Default rather than breaking the page.
 */
export const AWJ_THEME_PRE_PAINT_SCRIPT = `(function(){try{var t=window.localStorage.getItem(${JSON.stringify(
  AWJ_THEME_STORAGE_KEY
)});if(${PRE_PAINT_THEMES.map((theme) => `t===${JSON.stringify(theme)}`).join('||')}){document.documentElement.setAttribute(${JSON.stringify(
  AWJ_THEME_ATTRIBUTE
)},t);}}catch(e){}})();`;
