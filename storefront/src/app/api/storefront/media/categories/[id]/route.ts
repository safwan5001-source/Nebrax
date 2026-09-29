import { headers } from "next/headers";
import {
  buildStorefrontUrl,
  FORWARDED_HOST_HEADER,
  GATEWAY_SECRET_HEADER,
} from "@/lib/commerce/config";

/**
 * Browser-safe image boundary for AWJ category media.
 * Mirrors the existing product-media proxy while keeping publication,
 * tenant, and storage authority in Laravel.
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
    buildStorefrontUrl(`media/categories/${encodeURIComponent(id)}`),
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
