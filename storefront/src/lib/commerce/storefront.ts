import { storefrontFetch } from "./config";

interface AwjStorefrontConfig {
  default_locale: string | null;
}

interface AwjStorefrontConfigResponse {
  data: AwjStorefrontConfig;
}

/**
 * Fetches the resolved Storefront's minimal public configuration
 * (COM-7-P2B). Today this is only `default_locale` — see
 * `App\Http\Controllers\Api\StorefrontConfigController`. `null` when the
 * resolved context carries no `Storefront` row (the non-production legacy
 * `{tenantSlug}` path) — callers should treat that the same as "no
 * preference".
 */
export async function fetchStorefrontDefaultLocale(): Promise<string | null> {
  const response =
    await storefrontFetch<AwjStorefrontConfigResponse>("storefront");
  return response.data.default_locale;
}
