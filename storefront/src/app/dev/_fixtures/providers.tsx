import { PublishedThemeMarkerProvider } from "@/components/layout/PublishedThemeMarker";
import { AuthProvider } from "@/contexts/AuthContext";
import { CartProvider } from "@/contexts/CartContext";
import { StoreProvider } from "@/contexts/StoreContext";
import { WishlistProvider } from "@/contexts/WishlistContext";

/**
 * CUST-H2-5 — shared provider stack for `/dev/product-visual` and
 * `/dev/category-visual`. Mirrors `[country]/[locale]/layout.tsx`'s real
 * `CountryLocaleProviders` stack (`NextIntlClientProvider` →
 * `StoreProvider` → `AuthProvider` → `CartProvider` → `WishlistProvider`)
 * so the real `ProductDetails`/`ProductCard`/`WishlistButton` components can
 * mount unmodified without a live backend — every provider here fails
 * gracefully with no network available (each already does today, e.g.
 * `CartProvider.refreshCart()`'s own try/catch), so nothing needs mocking.
 * Shared here (unlike this package's other per-fixture `direction.tsx`
 * duplication) because the fixture market object is real, sizeable
 * boilerplate two fixtures would otherwise duplicate byte-for-byte.
 */
export function DevStorefrontProviders({
  locale,
  children,
}: {
  locale: "ar" | "en";
  children: React.ReactNode;
}) {
  return (
    <StoreProvider
      initialCountry="sa"
      initialLocale={locale}
      initialMarkets={[
        {
          id: "market-fixture",
          name: "Saudi Arabia",
          currency: "SAR",
          default_locale: "ar",
          tax_inclusive: true,
          default: true,
          country_isos: ["SA"],
          supported_locales: ["ar", "en"],
          countries: [
            {
              iso: "SA",
              iso3: "SAU",
              name: "Saudi Arabia",
              states_required: false,
              zipcode_required: false,
            },
          ],
        } as any,
      ]}
    >
      <AuthProvider>
        <CartProvider>
          <WishlistProvider>
            <PublishedThemeMarkerProvider themePreset="awj-modern">
              {children}
            </PublishedThemeMarkerProvider>
          </WishlistProvider>
        </CartProvider>
      </AuthProvider>
    </StoreProvider>
  );
}
