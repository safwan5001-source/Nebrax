"use client";

import { useLayoutEffect } from "react";

/**
 * `/dev` pins Arabic on `<html>`. This fixture applies `dir`/`lang` from the
 * query param before paint so English shots are LTR — byte-identical helper
 * to `dev/trust-visual/direction.tsx` and `dev/product-visual/direction.tsx`,
 * duplicated per this package's existing per-fixture convention.
 */
export function DirectionLock({ locale }: { locale: "ar" | "en" }) {
  useLayoutEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
  }, [locale]);
  return null;
}
