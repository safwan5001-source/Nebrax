import { headers } from "next/headers";
import {
  buildStorefrontUrl,
  FORWARDED_HOST_HEADER,
  GATEWAY_SECRET_HEADER,
} from "@/lib/commerce/config";
import {
  isFacetVisualMediaFile,
  isFacetVisualMediaId,
} from "@/lib/commerce/facet-visual-media";

/**
 * AWJ-VD-H1 / VD-1c (§3.8-c, owner decision D3) — same-origin delivery of
 * facet and value images. The Laravel origin resolves tenant, storefront and
 * sales channel ONLY from the forwarded host and re-runs every guard (owner
 * active, visible on this channel, referenced by the identity, media ready) on
 * every call, conditional ones included; it answers `private, no-store`.
 *
 * This route is the only layer allowed to set a shared-cacheable header, and it
 * is naturally host-partitioned (every storefront is its own origin):
 *   200 / 304 → public, max-age=300, must-revalidate  +  the origin's ETag.
 * A 304 is the origin re-authorizing the same bytes after all its guards, so it
 * refreshes the cached 200 for at most another 300 s. Every other status —
 * 404, 5xx, anything unexpected — is `no-store`: a failure is never cached.
 *
 * Documented window: once an image stops being authorized, the origin refuses
 * it at once and `meta.facets` drops it at once; a browser or shared cache that
 * already holds a 200 from this route may show it for at most 300 s, after
 * which its revalidation reaches the origin and gets the 404.
 *
 * Params are validated before anything is forwarded — a malformed id or a file
 * outside the list never reaches Laravel.
 */
export const FACET_VISUAL_MEDIA_CACHE_CONTROL =
  "public, max-age=300, must-revalidate";

export async function GET(
  request: Request,
  context: {
    params: Promise<{ visualId: string; mediaId: string; file: string }>;
  },
): Promise<Response> {
  const { visualId, mediaId, file } = await context.params;
  if (
    !isFacetVisualMediaId(visualId) ||
    !isFacetVisualMediaId(mediaId) ||
    !isFacetVisualMediaFile(file)
  ) {
    return notFound();
  }

  const requestHeaders = await headers();
  const visitorHost = requestHeaders.get("host");
  if (!visitorHost) {
    return notFound();
  }

  const upstreamHeaders: Record<string, string> = {
    Accept: "image/*",
    [FORWARDED_HOST_HEADER]: visitorHost,
  };
  const gatewaySecret = process.env.STOREFRONT_GATEWAY_SECRET;
  if (gatewaySecret) {
    upstreamHeaders[GATEWAY_SECRET_HEADER] = gatewaySecret;
  }
  const condition = request.headers.get("if-none-match");
  if (condition) {
    upstreamHeaders["If-None-Match"] = condition;
  }

  const upstream = await fetch(
    buildStorefrontUrl(
      `media/facet-visuals/${visualId}/${mediaId}/${encodeURIComponent(file)}`,
    ),
    { headers: upstreamHeaders, cache: "no-store" },
  );

  if (upstream.status !== 200 && upstream.status !== 304) {
    return new Response(null, {
      status: upstream.status === 404 ? 404 : 502,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const responseHeaders: Record<string, string> = {
    "Cache-Control": FACET_VISUAL_MEDIA_CACHE_CONTROL,
    "X-Content-Type-Options": "nosniff",
  };
  const etag = upstream.headers.get("etag");
  if (etag) {
    responseHeaders.ETag = etag;
  }

  if (upstream.status === 304) {
    return new Response(null, { status: 304, headers: responseHeaders });
  }

  const contentType = upstream.headers.get("content-type");
  if (contentType !== "image/webp" && contentType !== "image/jpeg") {
    // The origin only ever serves these two; anything else is not passed on.
    return new Response(null, {
      status: 502,
      headers: { "Cache-Control": "no-store" },
    });
  }
  responseHeaders["Content-Type"] = contentType;

  return new Response(await upstream.arrayBuffer(), {
    status: 200,
    headers: responseHeaders,
  });
}

function notFound(): Response {
  return new Response(null, {
    status: 404,
    headers: { "Cache-Control": "no-store" },
  });
}
