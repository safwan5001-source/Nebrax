"use client";

/**
 * AWJ-ANIMATED-MEDIA P1 — editor-only helpers for animated library assets (GIF / animated WebP).
 *
 * The editor never autoplays: a library grid of animations would be heavy and ignores
 * `prefers-reduced-motion`. The still first frame (the same poster the storefront shows to
 * reduced-motion visitors) is the default; motion plays only when the merchant asks for it.
 * The animated URL is the server's signed, sanitised copy — it never enters the document.
 */
import { Pause, Play } from "lucide-react";
import { useState } from "react";
import type { StorefrontMediaAsset } from "@/modules/commerce-workspace/storefront-media";
import type { CustomizerMessageKey } from "../messages";
import { mediaBtnClass } from "./ui";

type T = (key: CustomizerMessageKey) => string;

/** "3 frames · 0.6 s" — numerals follow the host page, the label follows the locale. */
export function motionSummary(asset: StorefrontMediaAsset, t: T): string | null {
  const a = asset.animation;
  if (!a) return null;
  const seconds = Math.round(a.durationMs / 100) / 10;
  return `${a.frames} ${t("mediaMotionFrames")} · ${seconds} ${t("mediaMotionSeconds")}`;
}

export function MotionBadge({ asset, t }: { asset: StorefrontMediaAsset; t: T }) {
  if (!asset.animation) return null;
  return (
    <span
      data-media-motion-badge=""
      className="inline-flex items-center border border-border bg-surface px-1.5 text-[10px] font-medium uppercase leading-4 text-muted"
    >
      {asset.animation.format.toUpperCase()} · {t("mediaMotionBadge")}
    </span>
  );
}

/** Still-by-default image with an explicit play/stop control (only when the asset is animated and playable). */
export function MotionPreviewImage({
  asset,
  poster,
  alt,
  t,
  imgClassName,
  controlClassName = "absolute bottom-1 start-1",
  compact = false,
}: {
  asset: StorefrontMediaAsset;
  poster: string | null;
  alt: string;
  t: T;
  imgClassName?: string;
  controlClassName?: string;
  compact?: boolean;
}) {
  const [playing, setPlaying] = useState(false);
  const animatedUrl = asset.animation?.url ?? null;
  const src = playing && animatedUrl ? animatedUrl : poster;
  const label = playing ? t("mediaMotionStop") : t("mediaMotionPlay");

  return (
    <>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived workspace URL
        <img src={src} alt={alt} loading="lazy" className={imgClassName} data-media-motion-playing={playing ? "" : undefined} />
      ) : null}
      {animatedUrl ? (
        <button
          type="button"
          onClick={() => setPlaying((p) => !p)}
          aria-pressed={playing}
          aria-label={label}
          title={label}
          data-media-motion-toggle=""
          className={`${mediaBtnClass} ${controlClassName} ${compact ? "min-h-8 px-2" : ""}`}
        >
          {playing ? <Pause aria-hidden="true" className="size-3.5" /> : <Play aria-hidden="true" className="size-3.5" />}
          {compact ? null : label}
        </button>
      ) : null}
    </>
  );
}
