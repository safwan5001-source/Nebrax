// AWJ v3 feature gate (Horizon 1; rollout switch added in Horizon 5).
//
// The gate is the `data-awj-ui="3"` attribute on <html>. Every v3 CSS rule is scoped
// under `html[data-awj-ui="3"]` (see web/src/app/globals.css), so this attribute being
// absent is what keeps the legacy experience byte-identical.
//
// Resolution order (first match wins):
//   1. `?awj-ui=3` / `?awj-ui=legacy`  — explicit, per browser, persisted to localStorage.
//   2. the stored choice               — `awj:ui-version` = "3" | "legacy".
//   3. the build default               — NEXT_PUBLIC_AWJ_UI_DEFAULT === "3" (rollout switch).
//   4. legacy.
//
// The build default is UNSET in every environment today, so (3) never applies and v3 stays
// strictly opt-in. Turning it on is an owner decision (MIGRATION.md §3 rollout, §6 rollback):
// set it, redeploy → every browser without an explicit choice gets v3. Rolling back is the
// reverse (unset + redeploy), and any single user can leave v3 with `?awj-ui=legacy`. Theme
// (`awj:theme`) and Light/Dark (`theme`) preferences live under their own keys and are not
// touched by any of this, so a rollback loses no preference.

export const AWJ_UI_QUERY_PARAM = 'awj-ui';
export const AWJ_UI_STORAGE_KEY = 'awj:ui-version';
export const AWJ_UI_GATE_VALUE = '3';
export const AWJ_UI_LEGACY_VALUE = 'legacy';

/** Routes that never opt in: they sit outside the workspace route groups (MIGRATION.md §1.4). */
export const AWJ_UI_EXCLUDED_PATH_PATTERN = '^(/$|/(login|register|forgot-password|reset-password|verify-email|auth|platform|document-qa|dev|fuel-stations|me|api)(/|$))';

/** The build-time default; `undefined`/anything but "3" means legacy. Pure for testing. */
export function resolveAwjUiDefault(envValue: string | undefined = process.env.NEXT_PUBLIC_AWJ_UI_DEFAULT): typeof AWJ_UI_GATE_VALUE | null {
  return envValue === AWJ_UI_GATE_VALUE ? AWJ_UI_GATE_VALUE : null;
}

export function readAwjUiPreference(buildDefault: typeof AWJ_UI_GATE_VALUE | null = resolveAwjUiDefault()): typeof AWJ_UI_GATE_VALUE | null {
  if (typeof window === 'undefined') return null;
  try {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get(AWJ_UI_QUERY_PARAM);
    if (fromQuery === AWJ_UI_GATE_VALUE) {
      window.localStorage.setItem(AWJ_UI_STORAGE_KEY, AWJ_UI_GATE_VALUE);
      return AWJ_UI_GATE_VALUE;
    }
    if (fromQuery === AWJ_UI_LEGACY_VALUE) {
      // With a default-on build the opt-out must be remembered; otherwise there is nothing to remember.
      if (buildDefault) window.localStorage.setItem(AWJ_UI_STORAGE_KEY, AWJ_UI_LEGACY_VALUE);
      else window.localStorage.removeItem(AWJ_UI_STORAGE_KEY);
      return null;
    }
    const stored = window.localStorage.getItem(AWJ_UI_STORAGE_KEY);
    if (stored === AWJ_UI_GATE_VALUE) return AWJ_UI_GATE_VALUE;
    if (stored === AWJ_UI_LEGACY_VALUE) return null;
    return buildDefault;
  } catch {
    return buildDefault;
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

/**
 * Pre-paint twin of readAwjUiPreference (same pattern as AWJ_THEME_PRE_PAINT_SCRIPT): sets
 * the attribute before first paint so a default-on build never flashes legacy→v3. Inert
 * unless the stored choice is "3", or there is no stored choice and the build default is on;
 * never runs on the excluded (non-workspace) paths; the query param is left to the layout.
 */
export function buildAwjUiPrePaintScript(buildDefault: typeof AWJ_UI_GATE_VALUE | null = resolveAwjUiDefault()): string {
  return `(function(){try{if(new RegExp(${JSON.stringify(AWJ_UI_EXCLUDED_PATH_PATTERN)}).test(location.pathname))return;var q=new URLSearchParams(location.search).get(${JSON.stringify(AWJ_UI_QUERY_PARAM)});var s=localStorage.getItem(${JSON.stringify(AWJ_UI_STORAGE_KEY)});var on=q==="3"||(q!=="legacy"&&(s==="3"||(s!=="legacy"&&${buildDefault ? 'true' : 'false'})));if(on)document.documentElement.setAttribute("data-awj-ui","3");}catch(e){}})();`;
}
