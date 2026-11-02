"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { isTrackingPath } from "@/lib/telemetry/scrub-tracking";

/**
 * COPS-H2-5 — third-party telemetry (tag manager, web analytics, speed insights) reads the page URL itself, and on a guest
 * tracking page that URL carries a reusable bearer token (`/track/{token}`). Those scripts are therefore not mounted at all
 * on tracking pages. Sentry is handled separately by event scrubbing (`lib/telemetry/scrub-tracking.ts`).
 *
 * Fails closed: the gate sits inside a `Suspense` with a null fallback, so until the pathname is known nothing loads.
 */
export function TrackingRouteTelemetryGate({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = usePathname();
  return isTrackingPath(pathname) ? null : children;
}
