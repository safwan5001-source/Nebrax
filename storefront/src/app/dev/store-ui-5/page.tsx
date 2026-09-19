"use client";

import { notFound, useSearchParams } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { Suspense, useMemo, useState } from "react";
import { AccountAddresses } from "@/components/account/AccountAddresses";
import { AccountOrderDetail } from "@/components/account/AccountOrderDetail";
import { AccountOrderList } from "@/components/account/AccountOrderList";
import { AccountOverview } from "@/components/account/AccountOverview";
import { AccountPaymentMethods } from "@/components/account/AccountPaymentMethods";
import { AccountProfileForm } from "@/components/account/AccountProfileForm";
import { AccountShell } from "@/components/account/AccountShell";
import { AccountSignIn } from "@/components/account/AccountSignIn";
import { AccountWishlist } from "@/components/account/AccountWishlist";
import { AuthContext, type User } from "@/contexts/AuthContext";
import { WishlistProvider } from "@/contexts/WishlistContext";
import { ACCOUNT_ORDER_PREVIEW } from "@/lib/commerce/account-preview";
import ar from "../../../../messages/ar.json";
import en from "../../../../messages/en.json";

const PREVIEW_USER: User = {
  id: "preview-user",
  email: "noura@example.com",
  first_name: "نورة",
  last_name: "العبدالله",
};

const SURFACES = [
  "signin",
  "overview",
  "orders",
  "orders-empty",
  "order-detail",
  "addresses",
  "wishlist",
  "profile",
  "payment",
] as const;

type Surface = (typeof SURFACES)[number];

function isSurface(value: string | null): value is Surface {
  return SURFACES.includes(value as Surface);
}

function previewPath(locale: "ar" | "en", surface: Surface) {
  const base = `/sa/${locale}/account`;
  switch (surface) {
    case "orders":
    case "orders-empty":
      return `${base}/orders`;
    case "order-detail":
      return `${base}/orders/${ACCOUNT_ORDER_PREVIEW.id}`;
    case "addresses":
      return `${base}/addresses`;
    case "wishlist":
      return `${base}/wishlist`;
    case "profile":
      return `${base}/profile`;
    case "payment":
      return `${base}/payment-methods`;
    default:
      return base;
  }
}

/**
 * Development-only visual harness for STORE-UI-5. Not linked from the
 * storefront, not found in production. Live account routes mount the same
 * components; this page exists so the designed surfaces can be reviewed
 * without a customer-order lookup contract.
 *
 * Query: `?surface=overview&locale=ar`
 */
export default function StoreUi5PreviewPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return (
    <Suspense fallback={null}>
      <StoreUi5Preview />
    </Suspense>
  );
}

function StoreUi5Preview() {
  const searchParams = useSearchParams();
  const initialLocale = searchParams.get("locale") === "en" ? "en" : "ar";
  const initialSurface = isSurface(searchParams.get("surface"))
    ? searchParams.get("surface")
    : "overview";

  const [locale, setLocale] = useState<"ar" | "en">(initialLocale);
  const [surface, setSurface] = useState<Surface>(
    (initialSurface as Surface) ?? "overview",
  );
  const messages = locale === "ar" ? ar : en;
  const signedIn = surface !== "signin";

  const auth = useMemo(
    () => ({
      user: signedIn ? PREVIEW_USER : null,
      loading: false,
      isAuthenticated: signedIn,
      login: async () => ({ success: true }),
      register: async () => ({ success: true }),
      logout: async () => undefined,
      refreshUser: async () => undefined,
    }),
    [signedIn],
  );

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <AuthContext.Provider value={auth}>
        <WishlistProvider>
          <div
            dir={locale === "ar" ? "rtl" : "ltr"}
            className="min-h-screen bg-store-background text-store-foreground"
          >
            <div className="border-b border-store-border" data-preview-chrome>
              <div className="mx-auto flex max-w-store flex-wrap items-center justify-between gap-3 px-4 py-3">
                <p className="text-sm font-medium">STORE-UI-5 preview</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded-store border border-store-border px-3 py-1 text-sm"
                    onClick={() => setLocale("ar")}
                  >
                    العربية
                  </button>
                  <button
                    type="button"
                    className="rounded-store border border-store-border px-3 py-1 text-sm"
                    onClick={() => setLocale("en")}
                  >
                    English
                  </button>
                </div>
              </div>
              <div className="mx-auto flex max-w-store flex-wrap gap-1 px-4 pb-3">
                {SURFACES.map((item) => (
                  <button
                    key={item}
                    type="button"
                    data-preview-surface={item}
                    className={`rounded-store px-2.5 py-1 text-xs ${
                      surface === item
                        ? "bg-store-primary text-store-primary-foreground"
                        : "border border-store-border"
                    }`}
                    onClick={() => setSurface(item)}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>

            <div data-preview-root={surface}>
              {surface === "signin" ? (
                <AccountSignIn />
              ) : (
                <AccountShell pathnameOverride={previewPath(locale, surface)}>
                  {surface === "overview" && <AccountOverview />}
                  {surface === "orders" && (
                    <AccountOrderList
                      orders={[ACCOUNT_ORDER_PREVIEW]}
                      basePath={`/sa/${locale}`}
                    />
                  )}
                  {surface === "orders-empty" && (
                    <AccountOrderList
                      orders={[]}
                      basePath={`/sa/${locale}`}
                      lookupUnavailable
                    />
                  )}
                  {surface === "order-detail" && (
                    <AccountOrderDetail
                      order={ACCOUNT_ORDER_PREVIEW}
                      basePath={`/sa/${locale}`}
                    />
                  )}
                  {surface === "addresses" && <AccountAddresses />}
                  {surface === "wishlist" && (
                    <AccountWishlist basePath={`/sa/${locale}`} />
                  )}
                  {surface === "profile" && (
                    <AccountProfileForm user={PREVIEW_USER} />
                  )}
                  {surface === "payment" && <AccountPaymentMethods />}
                </AccountShell>
              )}
            </div>
          </div>
        </WishlistProvider>
      </AuthContext.Provider>
    </NextIntlClientProvider>
  );
}
