import type { StorefrontPresentationConfig } from "@/lib/presentation/config";
import { readPublishedPresentation } from "@/lib/presentation/public";
import { storefrontFetch } from "./config";

export interface AwjStorefrontConfig {
  name: string | null;
  default_locale: string | null;
  /**
   * Published presentation only. `null` when nothing has been published —
   * callers must keep AWJ Modern / default homepage behaviour.
   * Draft is never present on this payload.
   */
  presentation: StorefrontPresentationConfig | null;
}

interface AwjStorefrontConfigResponse {
  data: {
    name?: string | null;
    default_locale?: string | null;
    presentation?: unknown;
  };
}

/**
 * Fetches the resolved Storefront's default locale (COM-7-P2B).
 * `null` when the resolved context carries no `Storefront` row (the
 * non-production legacy `{tenantSlug}` path) — callers should treat that
 * the same as "no preference".
 */
export async function fetchStorefrontDefaultLocale(): Promise<string | null> {
  const config = await fetchStorefrontConfig();
  return config.default_locale;
}

/**
 * Buyer-visible store name from the server-resolved storefront context.
 * Returns null when the catalog API cannot identify the store — never a
 * cross-tenant or environment-variable fallback.
 */
export async function fetchStorefrontName(): Promise<string | null> {
  try {
    const config = await fetchStorefrontConfig();
    const name = config.name?.trim();
    return name ? name : null;
  } catch {
    return null;
  }
}

/**
 * Published presentation snapshot, or `null` when never published / the
 * identity request fails. Never returns Draft.
 */
export async function fetchPublishedPresentation(): Promise<StorefrontPresentationConfig | null> {
  try {
    const config = await fetchStorefrontConfig();
    return config.presentation;
  } catch {
    return null;
  }
}

/**
 * Fetches the resolved Storefront's public configuration (COM-7-P2B / P3A +
 * STORE-BACKEND-1).
 *
 * `default_locale` is the store's language preference. `name` is the
 * buyer-visible store identity from the server-resolved Storefront
 * (or Tenant name on the non-production legacy `{tenantSlug}` path).
 *
 * `presentation` is the Published snapshot or `null`. This fetch uses
 * `cache: "no-store"` so a publish is visible on the next request.
 * Catalog/product GETs are not changed here.
 *
 * `name` is null only when the resolved context cannot expose a public
 * name — callers must not invent a tenant identity or fall back to
 * `NEXT_PUBLIC_STORE_NAME` / "Spree Store".
 */
export async function fetchStorefrontConfig(): Promise<AwjStorefrontConfig> {
  const response = await storefrontFetch<AwjStorefrontConfigResponse>(
    "storefront",
    undefined,
    { cache: "no-store" },
  );
  return {
    name: response.data.name ?? null,
    default_locale: response.data.default_locale ?? null,
    presentation: readPublishedPresentation(response.data.presentation ?? null),
  };
}
