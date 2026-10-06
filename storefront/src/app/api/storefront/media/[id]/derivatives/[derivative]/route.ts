import { headers } from "next/headers";
import {
  buildStorefrontUrl,
  FORWARDED_HOST_HEADER,
  GATEWAY_SECRET_HEADER,
} from "@/lib/commerce/config";

const ALLOWED_DERIVATIVES = new Set(["thumbnail", "card"]);

/**
 * Browser-safe proxy for the two public catalog derivatives. Laravel remains
 * authoritative for the hostname-resolved storefront, publication, tenant,
 * and storage checks; this route supplies only its server-side gateway headers.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; derivative: string }> },
): Promise<Response> {
  const { id, derivative } = await context.params;
  if (!ALLOWED_DERIVATIVES.has(derivative)) {
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

  const upstream = await fetch(
    buildStorefrontUrl(
      `media/${encodeURIComponent(id)}/derivatives/${derivative}`,
    ),
    { headers: upstreamHeaders },
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
