import { AWJ_THEME_ATTRIBUTE } from '@/lib/awj-theme';
import { AWJ_UI_GATE_VALUE } from '@/lib/awj-ui-gate';

/** Where the pre-paint script parks the attributes the page had before the landing took over. */
export const LANDING_PREV_KEY = '__awjLandingPrev';
export const LANDING_THEME = 'core';
export const LANDING_UI_ATTRIBUTE = 'data-awj-ui';

/**
 * Pre-paint script for the public landing page only. It applies the shared AWJ theme attributes
 * (`data-awj-ui="3"` + `data-awj-theme="core"`) so Core's tokens, which the shared theme system
 * generates, exist from the first paint. It writes nothing to storage: the user's own theme
 * preference is neither read nor changed, and `LandingTheme` restores the attributes on leave.
 */
export const LANDING_THEME_PRE_PAINT_SCRIPT = `(function(){try{var h=document.documentElement;window[${JSON.stringify(
  LANDING_PREV_KEY
)}]=[h.getAttribute(${JSON.stringify(LANDING_UI_ATTRIBUTE)}),h.getAttribute(${JSON.stringify(
  AWJ_THEME_ATTRIBUTE
)})];h.setAttribute(${JSON.stringify(LANDING_UI_ATTRIBUTE)},${JSON.stringify(
  AWJ_UI_GATE_VALUE
)});h.setAttribute(${JSON.stringify(AWJ_THEME_ATTRIBUTE)},${JSON.stringify(LANDING_THEME)});}catch(e){}})();`;
