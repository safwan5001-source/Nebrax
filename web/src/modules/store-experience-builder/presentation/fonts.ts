import { Cairo, Geist, Tajawal } from "next/font/google";

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
export const PREVIEW_FONT_VARIABLES = `${geist.variable} ${geistTajawalFallback.variable} ${cairo.variable} ${tajawal.variable}`;
