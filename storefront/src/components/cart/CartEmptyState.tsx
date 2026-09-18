"use client";

import { ArrowLeft, ArrowRight, ShoppingBag } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { localeDirection } from "@/i18n/locales";
import { cn } from "@/lib/utils";

/**
 * The empty cart.
 *
 * One component for both places a cart can be empty — the cart page and the
 * drawer — because they are the same moment in the journey at two densities.
 * It states the fact and offers the one action that resolves it; it does not
 * fill the space with recommendations, because AWJ exposes no product
 * relationship to recommend from (design-first policy §5.3) and an arbitrary
 * slice of the catalogue presented as a suggestion would be a claim.
 */
export function CartEmptyState({
  basePath,
  density = "page",
  onNavigate,
}: {
  basePath: string;
  density?: "page" | "drawer";
  onNavigate?: () => void;
}) {
  const t = useTranslations("cart");
  const tc = useTranslations("common");
  const rtl = localeDirection(useLocale()) === "rtl";
  const Arrow = rtl ? ArrowLeft : ArrowRight;

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        density === "page" ? "px-6 py-20" : "h-full px-6 py-12",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex items-center justify-center rounded-full bg-store-surface-muted text-store-muted-foreground",
          density === "page" ? "size-20" : "size-16",
        )}
      >
        <ShoppingBag
          className={density === "page" ? "size-9" : "size-7"}
          strokeWidth={1.5}
        />
      </span>
      <h2
        className={cn(
          "mt-5 font-bold text-store-foreground",
          density === "page" ? "text-xl sm:text-2xl" : "text-base",
        )}
      >
        {t("emptyCart")}
      </h2>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-store-muted-foreground">
        {t("emptyCartDescription")}
      </p>
      <Button
        asChild
        size={density === "page" ? "lg" : "default"}
        className="mt-6"
      >
        <Link href={`${basePath}/products`} onClick={onNavigate}>
          {tc("continueShopping")}
          <Arrow className="size-4" aria-hidden="true" />
        </Link>
      </Button>
    </div>
  );
}
