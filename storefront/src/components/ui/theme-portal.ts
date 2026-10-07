"use client";

import { useEffect, useState } from "react";

/**
 * The published theme wrapper (`[data-published-theme]` in `(storefront)/layout.tsx`) carries the
 * merchant's CSS variables and the global design tokens (`data-gt`, `--gt-*`). Radix overlays
 * (dialog, sheet, alert dialog, popover, dropdown) portal to `document.body` by default — outside
 * that wrapper — so a quick view, the cart drawer or a menu would silently lose the merchant's
 * brand colours, radius, fonts and button settings the moment it opens.
 *
 * Passing this element as the Portal `container` keeps overlay content inside the theme. It resolves
 * after mount (the wrapper is not in the document during the very first render), long before a
 * visitor can open an overlay; with no theme wrapper (a store with no published presentation) it
 * stays `undefined`, i.e. today's behaviour exactly.
 */
export function useThemePortalContainer(): HTMLElement | undefined {
  const [container, setContainer] = useState<HTMLElement | undefined>();
  useEffect(() => {
    setContainer(
      document.querySelector<HTMLElement>("[data-published-theme]") ??
        undefined,
    );
  }, []);
  return container;
}
