import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The storefront's shared content measure.
 *
 * Every shell region (header rows, category rail, footer, bottom navigation)
 * aligns to this one container so the brand, the search field, the first
 * category and the first footer column sit on the same vertical line at every
 * width. The maximum width comes from `--store-content-max` rather than a
 * literal so the shell keeps one measure even if the token is retuned.
 */
export const storeContainerClassName =
  "mx-auto w-full max-w-store px-4 sm:px-6 lg:px-8";

interface StoreContainerProps {
  children: ReactNode;
  className?: string;
}

export function StoreContainer({ children, className }: StoreContainerProps) {
  return (
    <div className={cn(storeContainerClassName, className)}>{children}</div>
  );
}
