/**
 * AWJ-VD-H1 / VD-1c (§3.8-c) — the one place that knows the shape of a facet
 * visual image URL. The origin emits the host-resolved path
 * `/store/v1/media/facet-visuals/{visualId}/{mediaId}/{file}` (valid for any
 * direct API client); a browser cannot reach it (it needs the server-only
 * forwarded-host headers), so the storefront rewrites it to the same-origin
 * proxy path below — or drops it when it is outside the contract. A raw origin
 * path never reaches an `<img>`.
 *
 *   {visualId} the `commerce_facet_visuals` row id (UUID)
 *   {mediaId}  the referenced media id (UUID) — part of the URL, so replacing
 *              an image changes the URL
 *   {file}     one of FACET_VISUAL_MEDIA_FILES; never an original
 */
export const AWJ_FACET_VISUAL_MEDIA_PROXY_PATH_PREFIX =
  "/api/storefront/media/facet-visuals/";

/** Mirrors `StorefrontFacetVisualProjector::FILES` (test-enforced against the PHP source). */
export const FACET_VISUAL_MEDIA_FILES = [
  "thumb-160.webp",
  "thumb-160.jpg",
  "thumb-320.webp",
  "thumb-320.jpg",
  "480w.webp",
  "480w.jpg",
  "768w.webp",
  "768w.jpg",
] as const;

export type FacetVisualMediaFile = (typeof FACET_VISUAL_MEDIA_FILES)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Lowercase only: the origin emits lowercase ids and refuses anything else. */
export function isFacetVisualMediaId(value: string): boolean {
  return UUID.test(value);
}

export function isFacetVisualMediaFile(
  value: string,
): value is FacetVisualMediaFile {
  return (FACET_VISUAL_MEDIA_FILES as readonly string[]).includes(value);
}

/** `null` when any segment is outside the contract — callers drop the image rather than guess. */
export function facetVisualMediaPath(
  visualId: string,
  mediaId: string,
  file: string,
): string | null {
  if (
    !isFacetVisualMediaId(visualId) ||
    !isFacetVisualMediaId(mediaId) ||
    !isFacetVisualMediaFile(file)
  ) {
    return null;
  }
  return `${AWJ_FACET_VISUAL_MEDIA_PROXY_PATH_PREFIX}${visualId}/${mediaId}/${file}`;
}

/**
 * Rewrites the raw origin path to the proxy path. Anything else under
 * `facet-visuals` — extra or missing segments, encoded separators, a query, a
 * foreign origin, a file outside the list — is `null`, never the raw URL.
 */
export function toRenderableFacetVisualMediaUrl(url: string): string | null {
  // Segments are matched on the raw string: no decoding, so `%2F`, `%2e%2e`
  // and friends can never be turned into a separator or a dot segment here.
  const match = url.match(
    /^\/store\/v1\/media\/facet-visuals\/([^/?#%]+)\/([^/?#%]+)\/([^/?#%]+)$/,
  );
  return match ? facetVisualMediaPath(match[1], match[2], match[3]) : null;
}
