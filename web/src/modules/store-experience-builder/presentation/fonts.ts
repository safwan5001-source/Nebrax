import {
  Amiri,
  Cairo,
  El_Messiri,
  Geist,
  IBM_Plex_Sans_Arabic,
  Inter,
  Lora,
  Noto_Sans_Arabic,
  Readex_Pro,
  Rubik,
  Tajawal,
} from "next/font/google";

/**
 * CUST-H3-2 — self-hosted next/font faces for the Customizer Canvas preview,
 * the same strategy and the same two families the public storefront's
 * DocumentShell loads (`storefront/src/components/layout/DocumentShell.tsx`).
 * Before this, the Canvas referenced the literal font-family names "Cairo"/
 * "Geist" with nothing registering those faces in the admin app, so it only
 * ever rendered whatever the browser substituted. Loading the real faces
 * here is what makes `fontPreset` an actual Canvas font stack instead of a
 * string the browser ignores — required for `tajawal-geist` to visibly
 * change the Canvas at all, and for true Canvas/Public parity on
 * `cairo-geist`.
 *
 * Scoped to this module only; the ERP admin chrome's own font (IBM Plex Sans
 * Arabic, `web/src/app/layout.tsx`) is untouched.
 */
const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
  display: "swap",
  fallback: ["Cairo"],
});

/**
 * CUST-H3-2-FIX-1 — a second Geist instance dedicated to `tajawal-geist`.
 * `fallback` bakes the named face directly into this instance's own CSS
 * value (see `presentation/tokens.ts#fontPresetFamilyStack`'s comment), so a
 * single shared `--font-geist` naming Cairo would always resolve Arabic to
 * Cairo first regardless of what came later in the stack. `--font-geist`
 * above stays untouched for `cairo-geist` and for every other existing
 * consumer (e.g. the `--font-sans` alias).
 */
const geistTajawalFallback = Geist({
  variable: "--font-geist-tajawal",
  subsets: ["latin"],
  display: "swap",
  fallback: ["Tajawal"],
});

const cairo = Cairo({
  variable: "--font-cairo",
  subsets: ["arabic"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

/**
 * Tajawal ships no 600 weight (verified against Next.js's bundled Google
 * Fonts metadata) — 400/500/700/800 approximates Cairo's weight set without
 * requesting an unavailable cut.
 */
const tajawal = Tajawal({
  variable: "--font-tajawal",
  subsets: ["arabic"],
  weight: ["400", "500", "700", "800"],
  display: "swap",
});

/**
 * Applied on the Canvas root so every variable `fontPresetFamilyStack()` can
 * reference — `--font-geist`, `--font-geist-tajawal`, `--font-cairo`,
 * `--font-tajawal` — actually resolves.
 */

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

/** The CSS variable classes of the catalogue faces, applied once on the document root. */
const CATALOGUE_FONT_VARIABLES = [
  plexArabic,
  inter,
  notoArabic,
  readex,
  rubik,
  elMessiri,
  lora,
  amiri,
]
  .map((font) => font.variable)
  .join(" ");

export const PREVIEW_FONT_VARIABLES = `${geist.variable} ${geistTajawalFallback.variable} ${cairo.variable} ${tajawal.variable} ${CATALOGUE_FONT_VARIABLES}`;
