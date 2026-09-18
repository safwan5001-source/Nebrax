"use client";

import { Heart } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ComponentProps, useEffect, useState } from "react";
import { AccountEmptyState } from "@/components/account/AccountEmptyState";
import { AccountGatedNotice } from "@/components/account/AccountGatedNotice";
import { ProductCard } from "@/components/products/ProductCard";
import { useWishlist } from "@/contexts/WishlistContext";
import { WISHLIST_CAPABILITY } from "@/lib/commerce/capabilities";
import { getProduct } from "@/lib/data/products";

type CatalogProduct = ComponentProps<typeof ProductCard>["product"];

const EMPTY_IDS: readonly string[] = [];

/**
 * Account-side wishlist. Reuses STORE-UI-3's `WishlistContext` — no second
 * favourites system, no browser storage. Products are read back through
 * the live catalogue contract so a heart the shopper just pressed can
 * still be shown for the life of the page.
 */
export function AccountWishlist({ basePath }: { basePath: string }) {
  const t = useTranslations("account");
  const wishlist = useWishlist();
  const ids = wishlist?.favoriteIds ?? EMPTY_IDS;
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [loading, setLoading] = useState(ids.length > 0);

  useEffect(() => {
    let cancelled = false;
    if (ids.length === 0) {
      setProducts([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    Promise.all(ids.map((id) => getProduct(id).catch(() => null))).then(
      (results) => {
        if (cancelled) return;
        setProducts(
          results.filter(
            (product): product is CatalogProduct => product !== null,
          ),
        );
        setLoading(false);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [ids]);

  return (
    <div>
      <h1 className="text-xl font-bold text-store-foreground">
        {t("wishlist")}
      </h1>

      {WISHLIST_CAPABILITY !== "live" && (
        <div className="mt-2">
          <AccountGatedNotice
            title={t("wishlistNotEnabledTitle")}
            body={t("wishlistNotEnabledBody")}
          />
        </div>
      )}

      {loading ? (
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {ids.map((id) => (
            <div
              key={id}
              className="aspect-[3/4] animate-pulse rounded-store bg-store-surface-muted motion-reduce:animate-none"
            />
          ))}
        </div>
      ) : products.length === 0 ? (
        <div className="mt-5">
          <AccountEmptyState
            icon={Heart}
            title={t("wishlistEmpty")}
            description={t("wishlistEmptyDescription")}
            actionHref={`${basePath}/products`}
            actionLabel={t("wishlistBrowse")}
          />
        </div>
      ) : (
        <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {products.map((product) => (
            <li key={product.id}>
              <ProductCard product={product} basePath={basePath} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
