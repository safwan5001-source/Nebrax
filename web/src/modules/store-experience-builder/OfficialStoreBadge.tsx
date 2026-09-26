import type { MouseEvent } from "react";
import {
  appStoreBadgeUrl,
  isSafeAppStoreUrl,
  isSafePlayStoreUrl,
  playStoreBadgeUrl,
} from "./presentation/urls";

export type OfficialStore = "apple" | "google";

/** Preview twin of the published storefront badge. Same hosts, same live URLs. */
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
      <img src={src} alt={label} className="h-10 w-auto" />
    </a>
  );
}
