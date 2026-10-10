"use client";

import { useEffect, useState } from "react";
import {
  type AnnouncementsDoc,
  nextAnnouncementBoundary,
  parseAnnouncementInstant,
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

type DisplayWindow = { startsAt?: string; endsAt?: string } | undefined;

/**
 * CUST-HV V6c-1 — the same clock for any list of display windows (Banner
 * sections). Identical contract to `useAnnouncementClock`: `null` until mounted,
 * re-read on every change to the list, and woken at the next edge only.
 */
export function useWindowsClock(windows: readonly DisplayWindow[]): number | null {
  const [nowMs, setNowMs] = useState<number | null>(null);
  const signature = JSON.stringify(windows);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-evaluate whenever the windows themselves change
  useEffect(() => {
    setNowMs(Date.now());
  }, [signature]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `signature` stands for `windows`
  useEffect(() => {
    if (nowMs === null) return;
    let next: number | null = null;
    for (const window of windows) {
      for (const edge of [window?.startsAt, window?.endsAt]) {
        const at = edge === undefined ? null : parseAnnouncementInstant(edge);
        if (at !== null && at > nowMs && (next === null || at < next)) next = at;
      }
    }
    if (next === null) return;
    const wait = Math.min(Math.max(next - nowMs, 0) + 50, MAX_TIMER_MS);
    const timer = setTimeout(() => setNowMs(Date.now()), wait);
    return () => clearTimeout(timer);
  }, [signature, nowMs]);

  return nowMs;
}
