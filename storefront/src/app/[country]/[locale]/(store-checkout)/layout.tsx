import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { CurrentYear } from "@/components/layout/CurrentYear";
import { StoreBrand } from "@/components/layout/StoreBrand";
import { DEFAULT_LOCALE, resolveSupportedLocale } from "@/i18n/locales";
import { fetchStorefrontName } from "@/lib/commerce/storefront";

/**
 * STORE-UI-4 — the AWJ checkout shell.
 *
 * The checkout deliberately does **not** use the storefront shell. It drops the
 * category rail, the search field, the cart button, the marketing footer and —
 * the decision this slice was asked to make explicitly — `MobileBottomNav`.
 *
 * Two reasons, both structural rather than stylistic:
 *
 * 1. Every one of those is a way back out of a flow the shopper has chosen to
 *    enter. A checkout that keeps offering the catalogue is a checkout that
 *    competes with itself.
 * 2. `MobileBottomNav` is `fixed` to the bottom of the viewport. The place-order
 *    action needs that space on a phone, and stacking a second fixed bar on top
 *    of the navigation is how a primary action ends up behind a tab bar or under
 *    the safe area. Removing the nav for this one route gives the action the
 *    bottom of the screen outright instead of negotiating for it.
 *
 * The route group carries no URL segment, so the path stays
 * `/{country}/{locale}/checkout` exactly as before. `CartProvider`, the cart
 * drawer and the toaster still come from the `[locale]` layout above this one —
 * the checkout is a different chrome over the same session, not a different app.
 *
 * The one way out is a link back to the cart, which is where an interrupted
 * checkout should land.
 */
export default async function StoreCheckoutLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ country: string; locale: string }>;
}) {
  const { country, locale } = await params;
  const basePath = `/${country}/${locale}`;
  // The locale is passed explicitly. A bare `getTranslations(namespace)` in a
  // server component of this route group resolves to the configured default
  // (Arabic) rather than the segment's locale, which showed up as an Arabic
  // "back to cart" link on the English checkout during visual QA.
  const messageLocale = resolveSupportedLocale(locale) ?? DEFAULT_LOCALE;
  const [storeName, t, footer] = await Promise.all([
    fetchStorefrontName(),
    getTranslations({ locale: messageLocale, namespace: "awjCheckout" }),
    getTranslations({ locale: messageLocale, namespace: "footer" }),
  ]);
  // Same fallback the storefront header uses, so the two shells never disagree
  // about what this store is called.
  const displayName = storeName?.trim() || footer("shop");

  return (
    <>
      <header className="border-b border-store-border bg-store-surface">
        <div className="mx-auto flex h-store-header max-w-store items-center justify-between gap-4 px-4 sm:px-6 lg:h-store-header-lg lg:px-8">
          <StoreBrand href={basePath} name={displayName} size="md" />
          <Link
            href={`${basePath}/cart`}
            className="rounded-md text-sm font-medium text-store-muted-foreground underline-offset-4 outline-none transition-colors hover:text-store-foreground hover:underline focus-visible:ring-2 focus-visible:ring-store-primary"
          >
            {t("returnToCart")}
          </Link>
        </div>
      </header>

      <main id="main-content" className="flex-1 bg-store-background">
        {children}
      </main>

      <footer className="border-t border-store-border bg-store-surface">
        <div className="mx-auto max-w-store px-4 py-5 text-xs text-store-muted-foreground sm:px-6 lg:px-8">
          <p>
            © <CurrentYear /> <bdi>{displayName}</bdi>
          </p>
        </div>
      </footer>
    </>
  );
}
