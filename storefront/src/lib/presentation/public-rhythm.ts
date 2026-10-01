/**
 * Published rhythm only. Unknown values fail closed to the current
 * comfortable / standard card. Null presentation uses the same defaults.
 */
export function publishedHomeStackClass(
  density: string | null | undefined,
): string {
  if (density === "compact") return "space-y-6 py-3";
  return "space-y-8 py-4 md:space-y-10 md:py-6";
}

export function publishedProductCardBodyClass(
  productCard: string | null | undefined,
): string {
  return productCard === "compact"
    ? "flex grow flex-col p-2.5"
    : "flex grow flex-col p-3";
}

/**
 * CUST-H3-3 — the Product and Category page shells' own outer vertical
 * padding. Matches the Customizer Canvas's `ProductPagePreview`/
 * `CategoryPagePreview` ready-state padding exactly (`StorefrontPreviewCanvas.tsx`),
 * so selecting a density actually changes these pages, not only the
 * homepage section rhythm `publishedHomeStackClass` already covered. The
 * AWJ Market theme's own compact chrome (`isMarket` branches elsewhere) is
 * untouched — this resolver only applies where no Market-specific override
 * already exists.
 */
export function publishedPageContainerPaddingClass(
  density: string | null | undefined,
): string {
  return density === "compact" ? "py-3" : "py-5 md:py-6";
}
