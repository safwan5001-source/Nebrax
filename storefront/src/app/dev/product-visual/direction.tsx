"use client";

import { useLayoutEffect } from "react";

/**
 * `/dev` pins Arabic on `<html>` (see `DocumentShell`/`DevLayout`). The
 * published `/[country]/[locale]` route sets `dir` from the URL locale
 * instead. This fixture applies that same attribute before paint so English
 * shots are LTR — byte-identical helper to `dev/trust-visual/direction.tsx`,
 * duplicated rather than shared cross-folder per this package's existing
 * per-fixture convention (`frame.tsx`/`harness.tsx`/`mirror.tsx` are never
 * shared between `/dev` fixtures either).
 */
export function DirectionLock({ locale }: { locale: "ar" | "en" }) {
  useLayoutEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
  }, [locale]);
  return null;
}
