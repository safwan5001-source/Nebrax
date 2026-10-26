import { getTranslations } from "next-intl/server";
import { fetchStorefrontConfig } from "@/lib/commerce/storefront";
import { publishedStoreName } from "@/lib/presentation/public";

/**
 * The store name buyers see in page titles and social metadata.
 *
 * It is the published identity of the Storefront the request host resolves to
 * (presentation display name, then the live store name) — the same rule the
 * storefront shell uses. `fetchStorefrontConfig` is `cache()`d per request and
 * `no-store` across requests, so this adds no API call and never shares a name
 * between tenants. Nothing here reads `NEXT_PUBLIC_STORE_NAME` or any other
 * deployment-wide setting: one deployment serves many stores.
 *
 * Returns `null` when the identity cannot be resolved; callers decide the
 * localized fallback (`storeTitleName`). A merchant name is never invented.
 */
export async function resolvePublishedStoreName(): Promise<string | null> {
  const identity = await fetchStorefrontConfig().catch(() => null);
  if (!identity) return null;
  const liveName = identity.name?.trim() ? identity.name : null;
  return (
    publishedStoreName(identity.presentation ?? null, liveName, "") || null
  );
}

/** Published name, else the neutral localized label the shell already uses (`footer.shop`). */
export async function resolveStoreTitleName(locale: string): Promise<string> {
  const published = await resolvePublishedStoreName();
  if (published) return published;
  const footer = await getTranslations({
    locale: locale as Locale,
    namespace: "footer",
  });
  return footer("shop");
}
