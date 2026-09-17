"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { storeContainerClassName } from "@/components/layout/StoreContainer";
import { localeDirection } from "@/i18n/locales";
import { cn } from "@/lib/utils";

/**
 * The shape the shell needs from an AWJ-authoritative category. Deliberately
 * narrow: the navigation renders what the catalogue already says and cannot
 * become a second place where category facts are defined.
 */
export interface StoreNavCategory {
  id: string;
  name: string;
  permalink: string;
}

interface CategoryNavProps {
  categories: StoreNavCategory[];
  basePath: string;
}

/** How far one press of a paging control travels, as a share of the rail. */
const PAGE_RATIO = 0.8;

const itemClassName =
  "relative inline-flex h-store-nav shrink-0 items-center whitespace-nowrap px-3 text-sm text-store-muted-foreground transition-colors hover:text-store-foreground after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-store-primary after:opacity-0 after:transition-opacity";

const activeItemClassName =
  "font-medium text-store-foreground after:opacity-100";

export function CategoryNav({ categories, basePath }: CategoryNavProps) {
  const t = useTranslations("header");
  const isRtl = localeDirection(useLocale()) === "rtl";
  const pathname = usePathname();
  const railRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState({ start: false, end: false });

  // `scrollLeft` counts down from 0 in RTL, so every measurement works on the
  // absolute distance travelled and only the paging direction is mirrored.
  const measure = useCallback(() => {
    const rail = railRef.current;
    if (!rail) return;
    const travelled = Math.abs(rail.scrollLeft);
    const remaining = rail.scrollWidth - rail.clientWidth - travelled;
    setOverflow({ start: travelled > 1, end: remaining > 1 });
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the observed nodes are `rail.children`, which the linter cannot see is derived from `categories`; without the dependency the observer keeps watching items a category change has already unmounted.
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;

    measure();
    // Observing the items as well as the rail keeps the controls correct when
    // the Arabic webfont swaps in and every label changes width after paint.
    const observer = new ResizeObserver(measure);
    observer.observe(rail);
    for (const item of rail.children) observer.observe(item);

    return () => observer.disconnect();
  }, [measure, categories]);

  const page = (direction: 1 | -1) => {
    const rail = railRef.current;
    if (!rail) return;
    const distance = rail.clientWidth * PAGE_RATIO * direction;
    rail.scrollBy({ left: isRtl ? -distance : distance });
  };

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  const allProductsHref = `${basePath}/products`;

  return (
    <nav
      aria-label={t("categoryNavigation")}
      className="border-b border-store-border bg-store-surface"
    >
      <div className={cn(storeContainerClassName, "relative")}>
        {/* The rail is pulled into the gutter so the first label lines up with
            the brand above it while its own padding keeps the hit areas even. */}
        <div
          ref={railRef}
          onScroll={measure}
          className="store-rail -mx-3 flex items-stretch"
        >
          <Link
            href={allProductsHref}
            className={cn(
              itemClassName,
              isActive(allProductsHref) && activeItemClassName,
            )}
          >
            {t("allProducts")}
          </Link>
          {categories.map((category) => {
            const href = `${basePath}/c/${category.permalink}`;
            return (
              <Link
                key={category.id}
                href={href}
                className={cn(
                  itemClassName,
                  isActive(href) && activeItemClassName,
                )}
              >
                {category.name}
              </Link>
            );
          })}
        </div>

        <PagingControl
          side="start"
          visible={overflow.start}
          label={t("scrollCategoriesBack")}
          isRtl={isRtl}
          onClick={() => page(-1)}
        />
        <PagingControl
          side="end"
          visible={overflow.end}
          label={t("scrollCategoriesForward")}
          isRtl={isRtl}
          onClick={() => page(1)}
        />
      </div>
    </nav>
  );
}

interface PagingControlProps {
  side: "start" | "end";
  visible: boolean;
  label: string;
  isRtl: boolean;
  onClick: () => void;
}

function PagingControl({
  side,
  visible,
  label,
  isRtl,
  onClick,
}: PagingControlProps) {
  if (!visible) return null;

  const pointsToStart = side === "start";
  // The glyph follows the reading direction rather than a fixed physical side.
  const Icon = pointsToStart === isRtl ? ChevronRight : ChevronLeft;

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-y-0 flex items-center from-store-surface from-65% to-transparent",
        pointsToStart
          ? "start-0 ps-4 pe-10 sm:ps-6 lg:ps-8 bg-linear-to-r rtl:bg-linear-to-l"
          : "end-0 pe-4 ps-10 sm:pe-6 lg:pe-8 bg-linear-to-l rtl:bg-linear-to-r",
      )}
    >
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className="pointer-events-auto inline-flex size-8 items-center justify-center rounded-full border border-store-border bg-store-surface text-store-muted-foreground transition-colors hover:border-store-border-strong hover:text-store-foreground"
      >
        <Icon className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}
