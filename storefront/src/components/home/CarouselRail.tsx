"use client";

import type { ComponentPropsWithoutRef, FocusEvent } from "react";

/**
 * AWJ-VD-H1 / VD-5 (D-S-2) — the discovery carousel's scroller: a plain `<ul>` plus one focus handler.
 *
 * Why it exists: when focus lands on a tile that is only *partly* inside a horizontal scroller, Chromium decides the
 * tile is "visible enough" and does not scroll at all (it scrolls only when the tile is fully hidden). Keyboard users
 * Tabbing through a rail whose next column peeks in at the edge therefore got a half-clipped, focused tile and a rail
 * that never moved (found at 390 px, RTL, two rows). CSS cannot drive a scroll from focus, so this nudges the rail.
 *
 * The behaviour is deliberately narrow:
 *  - nothing happens while the focused tile is fully inside the rail, so ordinary Tab/Shift+Tab never jumps;
 *  - only keyboard-initiated focus (`:focus-visible`) reveals. A mouse/touch press focuses the link on `mousedown`; an
 *    animated scroll then would move the tile from under the pointer before `mouseup` and could swallow the click.
 *    Where `:focus-visible` cannot be evaluated the focus is treated as keyboard, so the keyboard fix is never lost;
 *  - otherwise the tile is aligned to the rail's inline-start edge. That is exactly the `snap-start` position of the
 *    `<li>`s (with the rail's `scroll-padding`), so the mandatory snap has nothing left to correct, and the browser
 *    clamps at either end. The edge is logical, so RTL/LTR are the browser's own;
 *  - `scrollIntoView` honours the rail's own `motion-safe:scroll-smooth`, so reduced motion scrolls instantly.
 *
 * It adds no element, attribute, tab stop or role: the markup is the same `<ul>` the server rendered, and without
 * JavaScript the rail simply behaves as before.
 */
/** Sub-pixel layout rounding must not count as "clipped". */
const EPSILON = 0.5;

function isKeyboardFocus(target: Element): boolean {
  try {
    return target.matches(":focus-visible");
  } catch {
    return true;
  }
}

export function revealFocusedTile(event: FocusEvent<HTMLElement>): void {
  const rail = event.currentTarget;
  const tile = (event.target as Element).closest("li");
  if (!tile || !rail.contains(tile)) return;
  if (!isKeyboardFocus(event.target as Element)) return;
  const frame = rail.getBoundingClientRect();
  const box = tile.getBoundingClientRect();
  if (box.left >= frame.left - EPSILON && box.right <= frame.right + EPSILON) {
    return;
  }
  tile.scrollIntoView({ block: "nearest", inline: "start" });
}

export function CarouselRail(props: ComponentPropsWithoutRef<"ul">) {
  return <ul {...props} onFocus={revealFocusedTile} />;
}
