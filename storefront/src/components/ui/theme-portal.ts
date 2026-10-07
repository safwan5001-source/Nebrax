"use client";

import { usePathname } from "next/navigation";
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
 *
 * Overlays such as the cart drawer live in the shared `[country]/[locale]` layout and stay mounted
 * while the route groups beneath it swap (storefront ⇄ checkout), which removes and recreates the
 * wrapper. The container is therefore re-resolved whenever the route changes — never cached for the
 * component's lifetime — so it neither points at a detached node nor misses a wrapper that appeared.
 */
export function useThemePortalContainer(): HTMLElement | undefined {
  const pathname = usePathname();
  const [container, setContainer] = useState<HTMLElement | undefined>();
  // biome-ignore lint/correctness/useExhaustiveDependencies: the route change is the trigger
  useEffect(() => {
    setContainer(
      document.querySelector<HTMLElement>("[data-published-theme]") ??
        undefined,
    );
  }, [pathname]);
  return container;
}
