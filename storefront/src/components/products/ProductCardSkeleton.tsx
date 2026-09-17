import type * as React from "react";

/**
 * Skeleton placeholder for a single product card.
 * Mirrors `<ProductCard>`: bordered surface, height-bounded image tile,
 * eyebrow / title lines, and a divided price row.
 */
export function ProductCardSkeleton(): React.JSX.Element {
  return (
    <div className="animate-pulse rounded-store border border-store-border bg-store-surface p-2.5 motion-reduce:animate-none sm:p-3">
      <div className="h-36 rounded-[calc(var(--store-radius)-0.25rem)] bg-store-surface-muted sm:h-44 md:h-52" />
      <div className="pt-2.5">
        <div className="mb-1.5 h-2.5 w-1/3 rounded bg-store-surface-muted" />
        <div className="h-3.5 w-3/4 rounded bg-store-surface-muted" />
        <div className="mt-2.5 border-t border-store-border pt-2">
          <div className="h-4 w-1/3 rounded bg-store-surface-muted" />
        </div>
      </div>
    </div>
  );
}
