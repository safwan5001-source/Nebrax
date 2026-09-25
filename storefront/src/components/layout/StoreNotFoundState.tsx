"use client";

import { ArrowLeft, ArrowRight, SearchX } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { localeDirection } from "@/i18n/locales";

/**
 * Designed storefront 404. It sits inside the store shell and does not
 * invent a page, a product, or a catalog result.
 */
export function StoreNotFoundState() {
  const params = useParams<{ country?: string; locale?: string }>();
  const country = typeof params?.country === "string" ? params.country : "";
  const routeLocale = typeof params?.locale === "string" ? params.locale : "";
  const basePath = country && routeLocale ? `/${country}/${routeLocale}` : "/";
  const t = useTranslations("notFound");
  const rtl = localeDirection(useLocale()) === "rtl";
  const Arrow = rtl ? ArrowLeft : ArrowRight;

  return (
    <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
      <span
        aria-hidden="true"
        className="flex size-20 items-center justify-center rounded-full bg-store-surface-muted text-store-muted-foreground"
      >
        <SearchX className="size-9" strokeWidth={1.5} />
      </span>
      <h1 className="mt-5 text-xl font-bold text-store-foreground sm:text-2xl">
        {t("title")}
      </h1>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-store-muted-foreground">
        {t("description")}
      </p>
      <Button asChild size="lg" className="mt-6">
        <Link href={basePath}>
          {t("home")}
          <Arrow className="size-4" aria-hidden="true" />
        </Link>
      </Button>
    </div>
  );
}
