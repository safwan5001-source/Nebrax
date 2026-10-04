/**
 * FLOWERS-H10 — URL edits for the gifting filters. The catalog context lives
 * in the query string (`facet[<key>]`, `brand_id`, `deliver_today`; see
 * `listing-context.ts`); these helpers return a *new* `URLSearchParams` and
 * leave every unrelated key (`q`, `sort`, price, `collection`, …) untouched.
 * Multiple values of one facet are a comma list — OR within a dimension.
 */

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FACET_PARAM = /^facet\[[a-z0-9]+(?:[-_][a-z0-9]+)*\]$/;
const MAX_SLUGS = 20;

export function facetParam(key: string): string {
  return `facet[${key}]`;
}

export function selectedFacetSlugs(
  params: URLSearchParams,
  key: string,
): string[] {
  return (params.get(facetParam(key)) ?? "")
    .split(",")
    .map((slug) => slug.trim())
    .filter((slug) => SLUG.test(slug));
}

export function toggleFacetValue(
  params: URLSearchParams,
  key: string,
  slug: string,
): URLSearchParams {
  const next = new URLSearchParams(params.toString());
  if (!SLUG.test(slug)) return next;
  const current = selectedFacetSlugs(params, key);
  const updated = current.includes(slug)
    ? current.filter((value) => value !== slug)
    : [...current, slug].slice(0, MAX_SLUGS);
  if (updated.length === 0) next.delete(facetParam(key));
  else next.set(facetParam(key), updated.join(","));
  return next;
}

export function selectedBrand(params: URLSearchParams): string | null {
  return params.get("brand_id")?.trim() || null;
}

/** One brand at a time: choosing another replaces it, choosing it again clears. */
export function toggleBrand(
  params: URLSearchParams,
  brandId: string,
): URLSearchParams {
  const next = new URLSearchParams(params.toString());
  if (selectedBrand(params) === brandId) next.delete("brand_id");
  else next.set("brand_id", brandId);
  return next;
}

export function isDeliverToday(params: URLSearchParams): boolean {
  const value = params.get("deliver_today")?.trim().toLowerCase();
  return value === "true" || value === "1";
}

export function toggleDeliverToday(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params.toString());
  if (isDeliverToday(params)) next.delete("deliver_today");
  else next.set("deliver_today", "true");
  return next;
}

/** Removes the gifting filters only — `collection` and the listing's own filters stay. */
export function clearGiftingFilters(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams();
  for (const [key, value] of params.entries()) {
    if (
      FACET_PARAM.test(key) ||
      key === "brand_id" ||
      key === "deliver_today"
    ) {
      continue;
    }
    next.append(key, value);
  }
  return next;
}

export function countGiftingFilters(params: URLSearchParams): number {
  let count = isDeliverToday(params) ? 1 : 0;
  if (selectedBrand(params)) count += 1;
  for (const key of params.keys()) {
    if (!FACET_PARAM.test(key)) continue;
    const match = /^facet\[(.+)\]$/.exec(key);
    if (match) count += selectedFacetSlugs(params, match[1]).length;
  }
  return count;
}
