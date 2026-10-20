"use client";

import { usePathname } from "next/navigation";
import type { CSSProperties } from "react";
import type { StorefrontPresentationConfig } from "@/lib/presentation/config";
import type {
  ResolvedMedia,
  ResolvedMediaMap,
} from "@/lib/presentation/media-ref";
import { resolveRoleHex } from "@/lib/presentation/palette";
import type { StorefrontBackground } from "@/lib/presentation/storefront-background";

const PHONE = "(max-width: 767px)";
const EXCLUDED_SURFACE_SEGMENTS = new Set(["account", "checkout", "wholesale"]);
export function isStorefrontBackgroundRoute(pathname: string | null): boolean {
  if (!pathname) return false;
  return !pathname
    .split("/")
    .some((segment) => EXCLUDED_SURFACE_SEGMENTS.has(segment));
}

function srcSet(media: ResolvedMedia, format: "webp" | "jpg"): string {
  return media.sources
    .filter((source) => source.kind === "w" && source.format === format)
    .map((source) => `${source.src} ${source.width}w`)
    .join(", ");
}
function fallback(media: ResolvedMedia) {
  const widths = media.sources.filter((source) => source.kind === "w");
  return (
    widths.filter((source) => source.format === "jpg").at(-1) ??
    widths.at(-1) ??
    media.sources[0]
  );
}
function position(ref?: { focal?: { x: number; y: number } }): string {
  return ref?.focal ? `${ref.focal.x}% ${ref.focal.y}%` : "50% 50%";
}

/** Still-only global backdrop. It only paints a reference resolved by the published-media join. */
export function GlobalBackgroundLayer({
  background,
  resolved,
  presentation,
}: {
  background: StorefrontBackground | undefined;
  resolved: ResolvedMediaMap;
  presentation: StorefrontPresentationConfig | null;
}) {
  const pathname = usePathname();
  // Account pages share the storefront route-group layout but are deliberately not storefront presentation surfaces.
  if (!isStorefrontBackgroundRoute(pathname)) return null;
  if (!presentation || background?.kind !== "media") return null;
  const desktop = resolved["background.media"];
  if (!desktop?.sources.length) return null;
  const mobileCandidate = background.mobile
    ? resolved["background.mobile"]
    : undefined;
  const mobile = mobileCandidate?.sources.length ? mobileCandidate : undefined;
  const desktopFallback = fallback(desktop);
  if (!desktopFallback) return null;
  const mobileWebp = mobile ? srcSet(mobile, "webp") : "";
  const mobileJpg = mobile ? srcSet(mobile, "jpg") : "";
  const desktopWebp = srcSet(desktop, "webp");
  const overlay = background.overlay
    ? {
        color:
          "hex" in background.overlay.color
            ? background.overlay.color.hex
            : resolveRoleHex(background.overlay.color.role, presentation),
        opacity: background.overlay.alpha / 100,
      }
    : null;
  const imageStyle: CSSProperties &
    Record<"--global-bg-position" | "--global-bg-position-mobile", string> = {
    "--global-bg-position": position(background.media),
    "--global-bg-position-mobile": position(
      mobile ? background.mobile : background.media,
    ),
  };

  return (
    <div
      aria-hidden="true"
      data-global-background-layer=""
      data-has-mobile={mobile ? "" : undefined}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: -1,
        overflow: "hidden",
        pointerEvents: "none",
      }}
    >
      <picture>
        {mobileWebp ? (
          <source
            media={PHONE}
            type="image/webp"
            srcSet={mobileWebp}
            sizes="100vw"
          />
        ) : null}
        {mobileJpg ? (
          <source
            media={PHONE}
            type="image/jpeg"
            srcSet={mobileJpg}
            sizes="100vw"
          />
        ) : null}
        {desktopWebp ? (
          <source type="image/webp" srcSet={desktopWebp} sizes="100vw" />
        ) : null}
        <img
          data-global-background-image=""
          src={desktopFallback.src}
          srcSet={srcSet(desktop, "jpg") || undefined}
          sizes="100vw"
          width={desktop.width}
          height={desktop.height}
          alt=""
          loading="lazy"
          decoding="async"
          style={imageStyle}
        />
      </picture>
      {overlay ? (
        <div
          data-global-background-overlay=""
          style={{
            position: "absolute",
            inset: 0,
            backgroundColor: overlay.color,
            opacity: overlay.opacity,
          }}
        />
      ) : null}
    </div>
  );
}
