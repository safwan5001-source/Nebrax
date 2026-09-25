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
