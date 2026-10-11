/**
 * CUST-HV V7d-4 — where a navigation dropdown panel opens. Its default is the logical inline-start edge of its parent (V0 §11.3:
 * left in LTR, right in RTL). When that default would push the panel past the inline-end edge of the space it must fit in
 * (the viewport on the storefront, the Canvas frame in the editor) it opens from the parent's inline-end edge instead —
 * never clipped, never causing horizontal scroll. Pure so both renderers (twin files) decide identically.
 */

export interface InlineBounds {
  left: number;
  right: number;
}

/** Breathing room kept between a panel and the edge of its container, in px. */
export const NAV_PANEL_MARGIN = 8;

export function shouldFlipPanel(
  panel: InlineBounds,
  container: InlineBounds,
  rtl: boolean,
): boolean {
  return rtl
    ? panel.left < container.left + NAV_PANEL_MARGIN
    : panel.right > container.right - NAV_PANEL_MARGIN;
}
