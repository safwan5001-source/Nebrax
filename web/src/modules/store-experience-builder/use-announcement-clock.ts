"use client";

import { useEffect, useState } from "react";
import {
  type AnnouncementsDoc,
  nextAnnouncementBoundary,
} from "./presentation/announcements";

const MAX_TIMER_MS = 24 * 60 * 60 * 1000;

/**
 * "Now" for anything in the builder that shows announcement eligibility (the
 * Canvas preview and the panel's status chips). `null` until mounted — the
 * server clock is never baked into markup. Re-evaluated whenever the document
 * changes and at the next `startsAt` / `endsAt`, so an editor left open across
 * a window boundary keeps matching what the storefront will show. One timer,
 * clamped so a far-future date can never overflow `setTimeout`.
 */
export function useAnnouncementClock(
  doc: AnnouncementsDoc | undefined,
): number | null {
  const [nowMs, setNowMs] = useState<number | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-evaluate windows whenever the document itself changes
  useEffect(() => {
    setNowMs(Date.now());
  }, [doc]);

  useEffect(() => {
    if (nowMs === null) return;
    const boundary = nextAnnouncementBoundary(doc, nowMs);
    if (boundary === null) return;
    const wait = Math.min(Math.max(boundary - nowMs, 0) + 50, MAX_TIMER_MS);
    const timer = setTimeout(() => setNowMs(Date.now()), wait);
    return () => clearTimeout(timer);
  }, [doc, nowMs]);

  return nowMs;
}
