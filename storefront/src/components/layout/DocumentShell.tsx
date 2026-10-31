import { GoogleTagManager } from "@next/third-parties/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import {
  Alexandria,
  Almarai,
  Amiri,
  Cairo,
  El_Messiri,
  Geist,
  IBM_Plex_Sans_Arabic,
  Inter,
  Lora,
  Noto_Kufi_Arabic,
  Noto_Sans_Arabic,
  Readex_Pro,
  Reem_Kufi,
  Rubik,
  Tajawal,
} from "next/font/google";
import localFont from "next/font/local";
import { Suspense } from "react";
import { localeDirection } from "@/i18n/locales";

const gtmId = process.env.GTM_ID;

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
 * CUST-H3-2-FIX-1 — a second Geist instance dedicated to `tajawal-geist`.
 * `fallback` bakes the named face directly into *this instance's own* CSS
 * value, exactly like `geist` above does for Cairo — so a single shared
 * `--font-geist` naming Cairo would always resolve Arabic to Cairo first,
 * regardless of what a consuming font-family stack listed afterward
 * (`var(--font-geist), var(--font-tajawal)` would still expand to
 * `"Geist", Cairo, Tajawal`). `--font-geist` above stays untouched for
 * `cairo-geist` and for every other existing consumer (the `--font-sans`
 * Tailwind alias in `globals.css` included). See
 * `lib/presentation/tokens.ts#fontPresetFamilyStack` for how the two
 * instances are selected per merchant.
 */
const geistTajawalFallback = Geist({
  variable: "--font-geist-tajawal",
  subsets: ["latin"],
  display: "swap",
  fallback: ["Tajawal"],
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

/**
 * CUST-H3-2 — curated Arabic alternative, selectable per merchant via
 * `presentation.fontPreset` ("tajawal-geist"). Declared unconditionally here,
 * same as Cairo above, so it never requires an extra request: the browser
 * only fetches this face's file when the resolved `font-family`
 * (`fontPresetFamilyStack()`, `lib/presentation/tokens.ts`) actually
 * references it for a published store. Tajawal ships no 600 weight
 * (verified against Next.js's bundled Google Fonts metadata) —
 * 400/500/700/800 approximates Cairo's weight set above without requesting
 * an unavailable cut.
 */
const tajawal = Tajawal({
  variable: "--font-tajawal",
  subsets: ["arabic"],
  weight: ["400", "500", "700", "800"],
  display: "swap",
});

/**
 * CUST-HV V5e-2c — the curated font catalogue (`lib/presentation/font-catalogue.ts`): every face
 * is self-hosted by `next/font` (fetched at build time, served from the store's own origin),
 * subsetted to Arabic + Latin, `display: swap`, OFL-licensed (verified against each family's
 * upstream METADATA at slice time), and declared with `preload: false` — no preload link is
 * emitted for any of them, and the browser requests a face's file only when the resolved
 * `font-family` is used by rendered text. A Latin face paired with a separate Arabic face names
 * that Arabic family as its `fallback` (see the Geist/Cairo note above) so Arabic never falls to
 * a local Arial.
 */
const plexArabic = IBM_Plex_Sans_Arabic({
  variable: "--font-plex-arabic",
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "700"],
  display: "swap",
  preload: false,
});
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
  preload: false,
  fallback: ["Noto Sans Arabic"],
});
const notoArabic = Noto_Sans_Arabic({
  variable: "--font-noto-arabic",
  subsets: ["arabic"],
  display: "swap",
  preload: false,
});
const readex = Readex_Pro({
  variable: "--font-readex",
  subsets: ["arabic", "latin"],
  display: "swap",
  preload: false,
});
const rubik = Rubik({
  variable: "--font-rubik",
  subsets: ["arabic", "latin"],
  display: "swap",
  preload: false,
});
const elMessiri = El_Messiri({
  variable: "--font-el-messiri",
  subsets: ["arabic", "latin"],
  display: "swap",
  preload: false,
});
const lora = Lora({
  variable: "--font-lora",
  subsets: ["latin"],
  display: "swap",
  preload: false,
  fallback: ["Amiri"],
});
const amiri = Amiri({
  variable: "--font-amiri",
  subsets: ["arabic"],
  weight: ["400", "700"],
  display: "swap",
  preload: false,
});

const almarai = Almarai({
  variable: "--font-almarai",
  subsets: ["arabic", "latin"],
  weight: ["400", "700", "800"],
  display: "swap",
  preload: false,
});
const alexandria = Alexandria({
  variable: "--font-alexandria",
  subsets: ["arabic", "latin"],
  display: "swap",
  preload: false,
});
const notoKufi = Noto_Kufi_Arabic({
  variable: "--font-noto-kufi",
  subsets: ["arabic", "latin"],
  display: "swap",
  preload: false,
});
const reemKufi = Reem_Kufi({
  variable: "--font-reem-kufi",
  subsets: ["arabic", "latin"],
  display: "swap",
  preload: false,
});

/**
 * Thmanyah families — official WOFF2 files supplied by the project owner, used UNMODIFIED
 * (no subsetting / re-encoding). Licence: `docs/legal/thmanyah/`. The standard licence restricts
 * hosting and web embedding; shipping them here is an owner-accepted decision made WITHOUT a written
 * exception on file (see the Typography Expansion report §4). To remove: delete these declarations,
 * the `thmanyah-*` catalogue keys and the font files.
 * Loaded only when used (`preload: false`, `display: swap`); 400/500/700/900 cuts.
 */
const thmanyahSans = localFont({
  variable: "--font-thmanyah-sans",
  src: [
    {
      path: "../../fonts/thmanyah/thmanyahsans-Regular.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../../fonts/thmanyah/thmanyahsans-Medium.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "../../fonts/thmanyah/thmanyahsans-Bold.woff2",
      weight: "700",
      style: "normal",
    },
    {
      path: "../../fonts/thmanyah/thmanyahsans-Black.woff2",
      weight: "900",
      style: "normal",
    },
  ],
  display: "swap",
  preload: false,
  adjustFontFallback: "Arial",
});
const thmanyahSerifDisplay = localFont({
  variable: "--font-thmanyah-serif-display",
  src: [
    {
      path: "../../fonts/thmanyah/thmanyahserifdisplay-Regular.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../../fonts/thmanyah/thmanyahserifdisplay-Medium.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "../../fonts/thmanyah/thmanyahserifdisplay-Bold.woff2",
      weight: "700",
      style: "normal",
    },
    {
      path: "../../fonts/thmanyah/thmanyahserifdisplay-Black.woff2",
      weight: "900",
      style: "normal",
    },
  ],
  display: "swap",
  preload: false,
  adjustFontFallback: "Times New Roman",
});
const thmanyahSerifText = localFont({
  variable: "--font-thmanyah-serif-text",
  src: [
    {
      path: "../../fonts/thmanyah/thmanyahseriftext-Regular.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../../fonts/thmanyah/thmanyahseriftext-Medium.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "../../fonts/thmanyah/thmanyahseriftext-Bold.woff2",
      weight: "700",
      style: "normal",
    },
    {
      path: "../../fonts/thmanyah/thmanyahseriftext-Black.woff2",
      weight: "900",
      style: "normal",
    },
  ],
  display: "swap",
  preload: false,
  adjustFontFallback: "Times New Roman",
});

/** The CSS variable classes of the catalogue faces, applied once on the document root. */
export const CATALOGUE_FONT_VARIABLES = [
  plexArabic,
  inter,
  notoArabic,
  readex,
  rubik,
  elMessiri,
  lora,
  amiri,
  almarai,
  alexandria,
  notoKufi,
  reemKufi,
  thmanyahSans,
  thmanyahSerifDisplay,
  thmanyahSerifText,
]
  .map((font) => font.variable)
  .join(" ");

interface DocumentShellProps {
  children: React.ReactNode;
  locale: string;
}

/** Shared document markup for each root layout. */
export function DocumentShell({ children, locale }: DocumentShellProps) {
  return (
    <html lang={locale} dir={localeDirection(locale)} suppressHydrationWarning>
      {/* biome-ignore lint/style/noHeadElement: this shell is used only by Next.js root layouts */}
      <head />
      {gtmId && <GoogleTagManager gtmId={gtmId} />}
      <body
        className={`${geist.variable} ${geistTajawalFallback.variable} ${cairo.variable} ${tajawal.variable} ${CATALOGUE_FONT_VARIABLES} antialiased min-h-screen flex flex-col`}
      >
        <Suspense fallback={null}>{children}</Suspense>
        {/*
          Vercel Analytics / Speed Insights only exist on Vercel: their script URLs (`/_vercel/insights/script.js`)
          are served by the Vercel edge. On any other host (the production storefront runs on Railway) the request
          falls through to the app and returns an HTML 404, which the browser then refuses to run as a script
          (`X-Content-Type-Options: nosniff`) — two failing requests and two console errors on every page view.
        */}
        {process.env.VERCEL ? (
          <>
            <Analytics />
            <SpeedInsights />
          </>
        ) : null}
      </body>
    </html>
  );
}
