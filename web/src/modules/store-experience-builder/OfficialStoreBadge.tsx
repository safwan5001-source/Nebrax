import type { MouseEvent } from "react";
import {
  appStoreBadgeUrl,
  isSafeAppStoreUrl,
  isSafePlayStoreUrl,
  playStoreBadgeUrl,
} from "./presentation/urls";

export type OfficialStore = "apple" | "google";

/**
 * Preview twin of the published storefront badge. Same hosts, same live URLs.
 * Play is 60px tall because its official PNG includes clear space; that keeps
 * the artwork at least as tall as the 40px App Store badge. Do not crop it.
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
}: {
  store: OfficialStore;
  href: string;
  locale: string;
  label: string;
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const allowed =
    store === "apple" ? isSafeAppStoreUrl(href) : isSafePlayStoreUrl(href);
  if (!allowed) return null;
  const src =
    store === "apple" ? appStoreBadgeUrl(locale) : playStoreBadgeUrl(locale);
  return (
    <a href={href} className="inline-flex" onClick={onClick}>
      {/* First-party bytes only. Do not proxy or resize this badge. */}
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
