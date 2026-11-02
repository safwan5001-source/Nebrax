import type { Metadata } from "next";
import type { ReactNode } from "react";

/**
 * COPS-H2-5 — a guest tracking page is private to whoever holds the link: never indexed, and the link (which carries the
 * token in its path) is never leaked through `Referer` to another origin.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
  referrer: "strict-origin-when-cross-origin",
};

export default function TrackLayout({ children }: { children: ReactNode }) {
  return children;
}
