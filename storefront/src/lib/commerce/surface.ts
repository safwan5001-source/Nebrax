/**
 * A storefront surface is a distinct sales context. The DTC surface is the
 * public AWJ storefront; the wholesale surface is the opt-in gated B2B portal.
 *
 * The surface selects which client, which cart cookies and which cache
 * tags/keys a request uses, so the two contexts never mix. This module holds
 * the surface vocabulary only (type + constants) so catalogue code can name a
 * surface without importing the `@/lib/spree` wrapper; the client/cookie/cache
 * helpers that depend on a surface stay in `lib/spree/surface.ts`.
 */
export type Surface = "dtc" | "wholesale";

export const DEFAULT_SURFACE: Surface = "dtc";

/** All storefront surfaces. Iterate this to act on every surface at once
 * (e.g. clearing all carts on logout). */
export const SURFACES: readonly Surface[] = ["dtc", "wholesale"];
