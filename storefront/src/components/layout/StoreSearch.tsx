"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

/**
 * Search is the storefront's primary discovery action, so it is rendered as a
 * live field rather than behind a toggle: on mobile it occupies its own row
 * under the sticky identity bar, on `md` and wider it sits inline in the header.
 * Both placements mount the same lazy `SearchBar`, which keeps the suggestion
 * fetching and analytics out of the first header chunk exactly as the previous
 * toggle did.
 */
const SearchBar = dynamic(
  () =>
    import("@/components/search/SearchBar").then((mod) => ({
      default: mod.SearchBar,
    })),
  {
    loading: () => (
      <div
        aria-hidden="true"
        className="h-10 w-full rounded-md bg-store-surface-muted animate-pulse motion-reduce:animate-none"
      />
    ),
  },
);

interface StoreSearchProps {
  basePath: string;
  className?: string;
  /** The submit control only fits where the field has room for it. */
  withSubmit?: boolean;
}

export function StoreSearch({
  basePath,
  className,
  withSubmit,
}: StoreSearchProps) {
  const t = useTranslations("header");

  return (
    <div className={cn("w-full", className)}>
      <SearchBar
        basePath={basePath}
        className="h-11 rounded-store border-store-border bg-store-surface-muted"
        submitLabel={withSubmit ? t("submitSearch") : undefined}
        // At phone widths the button would take a quarter of the field; the
        // approved reference shows none there either.
        submitClassName="max-sm:hidden"
      />
    </div>
  );
}
