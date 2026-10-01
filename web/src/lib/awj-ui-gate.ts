// AWJ v3 feature gate (Horizon 1).
//
// The gate is the `data-awj-ui="3"` attribute on <html>. Every v3 CSS rule is scoped
// under `html[data-awj-ui="3"]` (see web/src/app/globals.css), so this attribute being
// absent is what keeps today's experience byte-identical — this module must never
// default it on.
//
// Opt-in is explicit and local to the browser: a `?awj-ui=3` query parameter persists
// the choice to localStorage so it survives navigation inside the (app) route group;
// `?awj-ui=legacy` clears it. This is the "internal/dev/QA opt-in path" required by the
// Horizon 1 brief — there is no environment-level or tenant-level default here, and none
// should be added without an explicit, separate rollout decision (see
// design-system/v3/MIGRATION.md §3).

export const AWJ_UI_QUERY_PARAM = 'awj-ui';
export const AWJ_UI_STORAGE_KEY = 'awj:ui-version';
export const AWJ_UI_GATE_VALUE = '3';

export function readAwjUiPreference(): typeof AWJ_UI_GATE_VALUE | null {
  if (typeof window === 'undefined') return null;
  try {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get(AWJ_UI_QUERY_PARAM);
    if (fromQuery === AWJ_UI_GATE_VALUE) {
      window.localStorage.setItem(AWJ_UI_STORAGE_KEY, AWJ_UI_GATE_VALUE);
      return AWJ_UI_GATE_VALUE;
    }
    if (fromQuery === 'legacy') {
      window.localStorage.removeItem(AWJ_UI_STORAGE_KEY);
      return null;
    }
    const stored = window.localStorage.getItem(AWJ_UI_STORAGE_KEY);
    return stored === AWJ_UI_GATE_VALUE ? AWJ_UI_GATE_VALUE : null;
  } catch {
    return null;
  }
}

export function applyAwjUiGate(): () => void {
  const version = readAwjUiPreference();
  if (version === AWJ_UI_GATE_VALUE) {
    document.documentElement.setAttribute('data-awj-ui', AWJ_UI_GATE_VALUE);
  } else {
    document.documentElement.removeAttribute('data-awj-ui');
  }
  return () => {
    document.documentElement.removeAttribute('data-awj-ui');
  };
}
