/**
 * CUST-HV V2c — the one place that knows the shape of a Customizer media URL
 * (V0 §7.8, AMEND-1/12). Renderers (Canvas and storefront) only ever emit the
 * same-origin proxy path below — never the raw host-resolved Laravel path
 * `/store/v1/media/customizer/...`, which a browser cannot reach (it needs
 * server-only forwarded-host headers).
 *
 *   {id}   a media id (UUID → base ladder) or a transformKey (32 hex →
 *          transform derivative, which carries its own source media)
 *   {file} `{width}w.{webp|jpg}` or `thumb-{160|320}.{webp|jpg}`
 *          (format is an explicit path segment — no Accept/Vary negotiation)
 */
export const AWJ_CUSTOMIZER_MEDIA_PROXY_PATH_PREFIX =
  "/api/storefront/media/customizer/";

const MEDIA_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRANSFORM_KEY = /^[a-f0-9]{32}$/;
const FILE = /^(?:\d{2,4}w|thumb-(?:160|320))\.(?:webp|jpg)$/;

export function isCustomizerMediaId(value: string): boolean {
  return MEDIA_ID.test(value) || TRANSFORM_KEY.test(value);
}

export function isCustomizerMediaFile(value: string): boolean {
  return FILE.test(value);
}

/** `null` when either segment is outside the contract — callers drop the image rather than guess. */
export function customizerMediaPath(id: string, file: string): string | null {
  if (!isCustomizerMediaId(id) || !isCustomizerMediaFile(file)) return null;
  return `${AWJ_CUSTOMIZER_MEDIA_PROXY_PATH_PREFIX}${id}/${file}`;
}

/** Rewrites a raw origin path to the proxy path; anything else is returned untouched. */
export function toRenderableCustomizerMediaUrl(url: string): string | null {
  try {
    const parsed = new URL(url, "http://awj.invalid");
    const match = parsed.pathname.match(
      /^\/store\/v1\/media\/customizer\/([^/]+)\/([^/]+)$/,
    );
    if (match) {
      return customizerMediaPath(
        decodeURIComponent(match[1]),
        decodeURIComponent(match[2]),
      );
    }
  } catch {
    // not a URL — fall through
  }
  return null;
}
