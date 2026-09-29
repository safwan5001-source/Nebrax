"use client";

import type { LucideIcon } from "lucide-react";
import { ImageIcon } from "lucide-react";
import Image, { type ImageProps } from "next/image";
import { useState } from "react";
import { AWJ_MEDIA_PROXY_PATH_PREFIX } from "@/lib/commerce/mappers";

type ProductImageProps = Omit<ImageProps, "src"> & {
  src: string | null | undefined;
  iconClassName?: string;
  icon?: LucideIcon;
};

/**
 * AWJ-R2-5 — every AWJ product image URL this component ever receives is
 * our own same-origin guarded proxy (`toRenderableMediaUrl()` in
 * `lib/commerce/mappers.ts` rewrites it to this exact prefix before it ever
 * reaches a component). `next/image`'s built-in optimizer treats a
 * local/relative `src` specially: instead of a real HTTP round trip, it
 * invokes the route handler *in-process* via a mocked request
 * (`next/dist/server/image-optimizer.js`'s `fetchInternalImage()` →
 * `createRequestResponseMocks()`) that carries **no headers at all** — not
 * even `Host`. Our proxy route needs the real visitor Host to forward as
 * `X-Storefront-Forwarded-Host` (how Laravel's `ResolveStorefrontDomain`
 * resolves the tenant for the guarded media read); without it, the route's
 * own `if (!visitorHost) return 404` fires immediately, and the request
 * never leaves this server to reach the AWJ API at all — the exact,
 * verified reason a published product's image silently never loads.
 * `unoptimized` makes the *browser* fetch this URL directly instead, which
 * carries the real Host header. A genuinely external/absolute URL (e.g. the
 * wholesale Spree surface's own CDN) is untouched and keeps Next's normal
 * remote optimization via `next.config.ts`'s `remotePatterns`.
 */
function isAwjMediaProxyUrl(src: string): boolean {
  return src.startsWith(AWJ_MEDIA_PROXY_PATH_PREFIX);
}

export function ProductImage({
  src,
  iconClassName = "w-8 h-8",
  icon: Icon = ImageIcon,
  onError,
  fetchPriority,
  unoptimized,
  ...rest
}: ProductImageProps): React.JSX.Element {
  const [hasError, setHasError] = useState(false);

  if (!src || hasError) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-gray-100 text-gray-300">
        <Icon className={iconClassName} />
      </div>
    );
  }

  return (
    <Image
      src={src}
      unoptimized={unoptimized ?? isAwjMediaProxyUrl(src)}
      onError={(e) => {
        setHasError(true);
        onError?.(e);
      }}
      fetchPriority={fetchPriority}
      loading={fetchPriority === "high" ? "eager" : undefined}
      {...rest}
    />
  );
}
