import { headers } from "next/headers";
import {
  buildStorefrontUrl,
  FORWARDED_HOST_HEADER,
  GATEWAY_SECRET_HEADER,
} from "@/lib/commerce/config";
import {
  isCustomizerAnimatedFile,
  isCustomizerMediaId,
  isCustomizerProxyFile,
} from "@/lib/commerce/customizer-media";
import {
  BodyTooLargeError,
  mediaProxyLimits,
  readBodyBounded,
  sharedMediaProxyGate,
  warnIfLimitsConstrained,
} from "@/lib/commerce/media-proxy-guard";

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
 *
 * AWJ-ANIMATED-MEDIA P2-0 — the body is still BUFFERED (that keeps slow visitors
 * off Laravel's Apache workers; Laravel-served bytes are never streamed to the
 * client), but the buffering is now bounded and guarded: at most
 * `maxBodyBytes` are ever held (whatever `Content-Length` says), only a bounded
 * number of origin round-trips run at once (globally and per visitor host), every
 * round-trip has a deadline and follows the visitor's disconnect, and every
 * failure is a uniform, uncached, body-less response — nothing about the origin
 * (URL, status text, secret, stack) reaches the client. See media-proxy-guard.ts.
 */
export const CUSTOMIZER_MEDIA_CACHE_CONTROL =
  "public, max-age=300, must-revalidate";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; file: string }> },
): Promise<Response> {
  const { id, file } = await context.params;
  if (!isCustomizerMediaId(id) || !isCustomizerProxyFile(file)) {
    return new Response(null, { status: 404 });
  }
  // The animated file belongs to a media id, never to a transform key.
  if (isCustomizerAnimatedFile(file) && id.length !== 36) {
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

  const limits = mediaProxyLimits();
  warnIfLimitsConstrained(limits);
  const gate = sharedMediaProxyGate(limits);
  let release: () => void;
  try {
    release = await gate.acquire(visitorHost.toLowerCase(), request.signal);
  } catch {
    // at capacity (or the visitor already left): shed load instead of queueing without bound
    return new Response(null, {
      status: 503,
      headers: { "Cache-Control": "no-store", "Retry-After": "2" },
    });
  }

  try {
    const upstream = await fetch(
      buildStorefrontUrl(
        `media/customizer/${encodeURIComponent(id)}/${encodeURIComponent(file)}`,
      ),
      {
        headers: upstreamHeaders,
        cache: "no-store",
        signal: AbortSignal.any([
          request.signal,
          AbortSignal.timeout(limits.timeoutMs),
        ]),
      },
    );

    // Anything but 200/304 is the origin's uniform "not available" — pass the
    // status through and never attach a public cache header to a failure.
    if (upstream.status !== 200 && upstream.status !== 304) {
      await upstream.body?.cancel().catch(() => undefined);
      return failure(upstream.status === 404 ? 404 : 502);
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
    const body = await readBodyBounded(upstream, limits.maxBodyBytes);
    return new Response(body, { status: 200, headers: responseHeaders });
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      // server-side only; the visitor just sees a uniform failure
      console.warn("[media-proxy] origin body over the bound", {
        id,
        file,
        limit: limits.maxBodyBytes,
      });
    }
    return failure(502);
  } finally {
    release();
  }
}

/** A body-less, uncached failure: identical for every cause, so nothing about the origin leaks. */
function failure(status: 404 | 502): Response {
  return new Response(null, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
