import { GoogleTagManager } from "@next/third-parties/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Cairo, Geist } from "next/font/google";
import { Suspense } from "react";
import { localeDirection } from "@/i18n/locales";

const gtmId = process.env.GTM_ID;
const spreeApiOrigin = (() => {
  try {
    return process.env.SPREE_API_URL
      ? new URL(process.env.SPREE_API_URL).origin
      : undefined;
  } catch {
    return undefined;
  }
})();

/**
 * `fallback` is what makes the Arabic face reachable, and it is load-bearing.
 *
 * By default `--font-geist` expands to `"Geist", "Geist Fallback"`, where that
 * second face is `local(Arial)` with no `unicode-range`. It therefore answers
 * for Arabic as well, and Cairo — declared after it in the body stack — never
 * receives the glyph, so Arabic silently renders in metric-warped Arial.
 * Naming Cairo here makes the variable expand to `"Geist", Cairo` instead.
 *
 * `adjustFontFallback: false` would express the same intent, but the Turbopack
 * build ignores it (verified against the emitted CSS); this option it honours.
 */
const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
  display: "swap",
  fallback: ["Cairo"],
});

/**
 * Arabic is the storefront's default locale, and Geist ships no Arabic glyphs —
 * without this the primary language rendered in whatever the device happened to
 * have. Cairo is the face the approved Responsive Visual Baseline V1 reference
 * is drawn in, and the storefront's typographic weight hierarchy depends on the
 * heavy cuts it carries. (AWJ_STORE_DEFAULT_DESIGN_DIRECTION.md §5 named Tajawal
 * as the earlier default and says explicitly that it is not a permanent
 * constraint; the newer approved reference supersedes it.)
 *
 * Both faces are declared on every document and the browser resolves per
 * character, so an Arabic product title inside an English page — and the
 * reverse — still renders in the right face.
 */
const cairo = Cairo({
  variable: "--font-cairo",
  subsets: ["arabic"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

interface DocumentShellProps {
  children: React.ReactNode;
  locale: string;
}

/** Shared document markup for each root layout. */
export function DocumentShell({ children, locale }: DocumentShellProps) {
  return (
    <html lang={locale} dir={localeDirection(locale)} suppressHydrationWarning>
      {/* biome-ignore lint/style/noHeadElement: this shell is used only by Next.js root layouts */}
      <head>
        {spreeApiOrigin && (
          <>
            <link rel="preconnect" href={spreeApiOrigin} />
            <link rel="dns-prefetch" href={spreeApiOrigin} />
          </>
        )}
      </head>
      {gtmId && <GoogleTagManager gtmId={gtmId} />}
      <body
        className={`${geist.variable} ${cairo.variable} antialiased min-h-screen flex flex-col`}
      >
        <Suspense fallback={null}>{children}</Suspense>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
