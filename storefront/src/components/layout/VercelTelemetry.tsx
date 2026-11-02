"use client";

import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { redactTrackingEventUrl } from "@/lib/telemetry/scrub-tracking";

/**
 * COPS-H2-5 — Vercel Analytics / Speed Insights with their `beforeSend` callbacks attached. Both packages are Client
 * Components, so a callback can only be passed from another Client Component (a function prop cannot cross the
 * server→client boundary from `DocumentShell`). Mounted behind `TrackingRouteTelemetryGate`; the redaction is the second layer.
 */
export function VercelTelemetry() {
  return (
    <>
      <Analytics beforeSend={redactTrackingEventUrl} />
      <SpeedInsights beforeSend={redactTrackingEventUrl} />
    </>
  );
}
