import type { StorefrontPresentationConfig } from "@/lib/presentation/config";
import { readPublishedPresentation } from "@/lib/presentation/public";
import { storefrontFetch } from "./config";

export interface AwjStorefrontConfig {
  name: string | null;
  default_locale: string | null;
  business_identity: AwjBusinessIdentity;
  /**
   * Published presentation only. `null` when nothing has been published —
   * callers must keep AWJ Modern / default homepage behaviour.
   * Draft is never present on this payload.
   */
  presentation: StorefrontPresentationConfig | null;
}

export interface AwjBusinessIdentity {
  legal_name: string | null;
  cr_number: string | null;
  vat_number: string | null;
}

interface AwjStorefrontConfigResponse {
  data: {
    name?: string | null;
    default_locale?: string | null;
    business_identity?: unknown;
    presentation?: unknown;
  };
}

function readBusinessIdentity(raw: unknown): AwjBusinessIdentity {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return { legal_name: null, cr_number: null, vat_number: null };
  }

  const value = raw as Record<string, unknown>;
  const nullableString = (candidate: unknown): string | null => {
    if (typeof candidate !== "string") return null;
    const trimmed = candidate.trim();
    return trimmed || null;
  };

  return {
    legal_name: nullableString(value.legal_name),
    cr_number: nullableString(value.cr_number),
    vat_number: nullableString(value.vat_number),
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
    business_identity: readBusinessIdentity(response.data.business_identity),
    presentation: readPublishedPresentation(response.data.presentation ?? null),
  };
}
