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
 */
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
      <img src={src} alt={label} className="h-10 w-auto" />
    </a>
  );
}
