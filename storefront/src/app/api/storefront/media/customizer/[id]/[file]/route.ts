import { headers } from "next/headers";
import {
  buildStorefrontUrl,
  FORWARDED_HOST_HEADER,
  GATEWAY_SECRET_HEADER,
} from "@/lib/commerce/config";
import {
  isCustomizerMediaFile,
  isCustomizerMediaId,
} from "@/lib/commerce/customizer-media";

/**
 * CUST-HV V2c — same-origin delivery of Customizer media (V0 §7.8,
 * AMEND-1/4/12/16). The Laravel origin resolves tenant and storefront ONLY from
 * the forwarded host and re-runs the Published-reference gate on every call; it
 * answers `private, no-store`, so nothing between this proxy and Laravel can
 * ever replay one storefront's answer to another.
 *
 * This route is the **only** layer allowed to set a shared-cacheable header, and
 * it is naturally host-partitioned (every storefront is its own origin, so the
 * URL a shared cache keys on already differs per storefront):
 *   public, max-age=300, must-revalidate  +  the origin's content-derived ETag.
 * Revalidation is a conditional GET that still reaches the origin gate, so an
 * unpublished or deleted id stops being served within one 5-minute window.
 *
 * Params are validated against the contract before anything is forwarded — a
 * malformed id/file never reaches Laravel.
 */
export const CUSTOMIZER_MEDIA_CACHE_CONTROL =
  "public, max-age=300, must-revalidate";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; file: string }> },
): Promise<Response> {
  const { id, file } = await context.params;
  if (!isCustomizerMediaId(id) || !isCustomizerMediaFile(file)) {
    return new Response(null, { status: 404 });
  }

  const requestHeaders = await headers();
  const visitorHost = requestHeaders.get("host");
  if (!visitorHost) {
    return new Response(null, { status: 404 });
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
      `media/customizer/${encodeURIComponent(id)}/${encodeURIComponent(file)}`,
    ),
    { headers: upstreamHeaders, cache: "no-store" },
  );

  // Anything but 200/304 is the origin's uniform "not available" — pass the
  // status through and never attach a public cache header to a failure.
  if (upstream.status !== 200 && upstream.status !== 304) {
    return new Response(null, {
      status: upstream.status === 404 ? 404 : 502,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const responseHeaders: Record<string, string> = {
    "Cache-Control": CUSTOMIZER_MEDIA_CACHE_CONTROL,
    "X-Content-Type-Options": "nosniff",
  };
  const etag = upstream.headers.get("etag");
  if (etag) {
    responseHeaders.ETag = etag;
  }

  if (upstream.status === 304) {
    return new Response(null, { status: 304, headers: responseHeaders });
  }

  responseHeaders["Content-Type"] =
    upstream.headers.get("content-type") ?? "application/octet-stream";
  return new Response(await upstream.arrayBuffer(), {
    status: 200,
    headers: responseHeaders,
  });
}
