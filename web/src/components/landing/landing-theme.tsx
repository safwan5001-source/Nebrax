'use client';

import { useEffect, useLayoutEffect } from 'react';
import { AWJ_THEME_ATTRIBUTE } from '@/lib/awj-theme';
import { AWJ_UI_GATE_VALUE } from '@/lib/awj-ui-gate';
import { LANDING_PREV_KEY, LANDING_THEME, LANDING_UI_ATTRIBUTE } from './landing-theme-script';

type Prev = [string | null, string | null];

function applyCore(root: HTMLElement) {
  root.setAttribute(LANDING_UI_ATTRIBUTE, AWJ_UI_GATE_VALUE);
  root.setAttribute(AWJ_THEME_ATTRIBUTE, LANDING_THEME);
}

/**
 * Keeps AWJ Core (the shared v3 theme) active while the public landing page is mounted and gives
 * the page back as it was found. It reuses the shared attributes and tokens and adds no theme of
 * its own; it never writes localStorage, so no stored preference changes.
 *
 * Two lifecycles meet here and neither is changed:
 * - the visitor's theme (`data-awj-theme`) is a preference nobody else touches during navigation,
 *   so it is captured on mount and restored on leave;
 * - the gate (`data-awj-ui`) belongs to the route group that wants it. Workspace layouts apply it
 *   in a passive effect and remove it in that effect's cleanup, which runs *after* this layout
 *   effect when a workspace route is replaced by the landing page. So the gate is set again in a
 *   passive effect (passive cleanups of the outgoing tree always run before passive effects of
 *   the incoming one), and on leave it is simply removed: the landing page is excluded from the
 *   gate, and any gated destination applies it itself.
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
    applyCore(root);

    return () => {
      const theme = prev[1];
      root.removeAttribute(LANDING_UI_ATTRIBUTE);
      if (theme === null) root.removeAttribute(AWJ_THEME_ATTRIBUTE);
      else root.setAttribute(AWJ_THEME_ATTRIBUTE, theme);
      delete holder[LANDING_PREV_KEY];
    };
  }, []);

  // After the outgoing route's passive cleanups (see above); idempotent when nothing removed the gate.
  useEffect(() => {
    applyCore(document.documentElement);
  }, []);

  return null;
}
