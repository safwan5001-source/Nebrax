"use client";

import { useLayoutEffect } from "react";

/**
 * `/dev` pins Arabic on `<html>`. The published country/locale route sets
 * `dir` from the URL locale in DocumentShell. This fixture applies that same
 * attribute before paint so English shots are LTR.
 */
export function DirectionLock({ locale }: { locale: "ar" | "en" }) {
  useLayoutEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
  }, [locale]);
  return null;
}
