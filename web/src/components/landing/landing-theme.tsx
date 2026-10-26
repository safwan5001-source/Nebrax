'use client';

import { useLayoutEffect } from 'react';
import { AWJ_THEME_ATTRIBUTE } from '@/lib/awj-theme';
import { AWJ_UI_GATE_VALUE } from '@/lib/awj-ui-gate';
import { LANDING_PREV_KEY, LANDING_THEME, LANDING_UI_ATTRIBUTE } from './landing-theme-script';

type Prev = [string | null, string | null];

/**
 * Keeps AWJ Core (the shared v3 theme) active while the public landing page is mounted and gives
 * the page back exactly as it was found. It reuses the shared attributes and tokens and adds no
 * theme of its own; it never writes localStorage, so no stored preference changes and ERP pages
 * (which are excluded from this) keep using whatever the user chose.
 */
export function LandingTheme() {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const holder = window as unknown as Record<string, Prev | undefined>;
    const alreadyApplied =
      root.getAttribute(LANDING_UI_ATTRIBUTE) === AWJ_UI_GATE_VALUE &&
      root.getAttribute(AWJ_THEME_ATTRIBUTE) === LANDING_THEME;
    const prev: Prev =
      alreadyApplied && holder[LANDING_PREV_KEY]
        ? (holder[LANDING_PREV_KEY] as Prev)
        : [root.getAttribute(LANDING_UI_ATTRIBUTE), root.getAttribute(AWJ_THEME_ATTRIBUTE)];
    holder[LANDING_PREV_KEY] = prev;
    root.setAttribute(LANDING_UI_ATTRIBUTE, AWJ_UI_GATE_VALUE);
    root.setAttribute(AWJ_THEME_ATTRIBUTE, LANDING_THEME);

    return () => {
      const [ui, theme] = prev;
      if (ui === null) root.removeAttribute(LANDING_UI_ATTRIBUTE);
      else root.setAttribute(LANDING_UI_ATTRIBUTE, ui);
      if (theme === null) root.removeAttribute(AWJ_THEME_ATTRIBUTE);
      else root.setAttribute(AWJ_THEME_ATTRIBUTE, theme);
      delete holder[LANDING_PREV_KEY];
    };
  }, []);

  return null;
}
