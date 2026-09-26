import type { MouseEvent } from "react";
import {
  appStoreBadgeUrl,
  isSafeAppStoreUrl,
  isSafePlayStoreUrl,
  playStoreBadgeUrl,
} from "@/lib/presentation/urls";

export type OfficialStore = "apple" | "google";

/**
 * Unmodified first-party store badge. Renders nothing unless the destination
 * already passes the store-host allow-list. The image is loaded from the
 * publisher URL; it is not committed, inlined, or redrawn.
 *
 * Apple's live SVG fills a 40px box, which is the on-screen minimum.
 * The Play PNG is 646×250 and includes its own clear space, so a 40px box
 * would make the artwork shorter than the App Store badge. 60px keeps the
 * Play artwork at least 40px tall without cropping or redrawing the file.
 */
const BADGE_FRAME = {
  apple: "h-10 w-auto",
  google: "h-[60px] w-auto",
} as const;

const BADGE_SIZE = {
  apple: { width: 120, height: 40 },
  google: { width: 646, height: 250 },
} as const;
export function OfficialStoreBadge({
  store,
  href,
  locale,
  label,
  onClick,
  newTab = true,
}: {
  store: OfficialStore;
  href: string;
  locale: string;
  label: string;
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
  newTab?: boolean;
}) {
  const allowed =
    store === "apple" ? isSafeAppStoreUrl(href) : isSafePlayStoreUrl(href);
  if (!allowed) return null;
  const src =
    store === "apple" ? appStoreBadgeUrl(locale) : playStoreBadgeUrl(locale);
  return (
    <a
      href={href}
      className="inline-flex"
      {...(newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      onClick={onClick}
    >
      {/* First-party bytes only. next/image would proxy and resize the badge. */}
      {/* biome-ignore lint/performance/noImgElement: official badge must not be rewritten */}
      <img
        src={src}
        alt={label}
        width={BADGE_SIZE[store].width}
        height={BADGE_SIZE[store].height}
        className={BADGE_FRAME[store]}
      />
    </a>
  );
}
