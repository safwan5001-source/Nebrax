import { headers } from "next/headers";
import {
  buildStorefrontUrl,
  FORWARDED_HOST_HEADER,
  GATEWAY_SECRET_HEADER,
} from "@/lib/commerce/config";

/**
 * Browser-safe image boundary for AWJ media. The Laravel media endpoint is
 * hostname-resolved and requires the server-only forwarded-host gateway
 * headers; the browser cannot provide those headers safely. This route keeps
 * the existing publication, tenant, storage, and media checks authoritative
 * in Laravel and only proxies the guarded response.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
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

  const upstream = await fetch(
    buildStorefrontUrl(`media/${encodeURIComponent(id)}`),
    {
      headers: upstreamHeaders,
    },
  );

  if (!upstream.ok) {
    return new Response(null, { status: upstream.status });
  }

  return new Response(await upstream.arrayBuffer(), {
    status: upstream.status,
    headers: {
      "Content-Type":
        upstream.headers.get("content-type") ?? "application/octet-stream",
      "Cache-Control":
        upstream.headers.get("cache-control") ?? "public, max-age=3600",
    },
  });
}
