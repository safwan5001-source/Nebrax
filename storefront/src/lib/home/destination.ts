/**
 * Where an authored homepage link points. A merchant-authored href is an `https://` URL or a
 * leading-`/` store path (prefixed with the store's `basePath` unless it already carries it);
 * anything else resolves to `null` and renders no link. Shared by the Banner and the Hero CTAs so
 * the two can never disagree.
 */
export function destination(basePath: string, href: string): string | null {
  if (!href) return null;
  if (href.startsWith("https://")) return href;
  if (!href.startsWith("/")) return null;
  if (href === basePath || href.startsWith(`${basePath}/`)) return href;
  return `${basePath}${href}`;
}
