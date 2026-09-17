import type * as React from "react";

/**
 * Skeleton placeholder for a single product card.
 * Mirrors `<ProductCard>`: one bordered frame, a flush height-bounded image
 * area, then the eyebrow / title / price lines.
 */
export function ProductCardSkeleton(): React.JSX.Element {
  return (
    <div className="animate-pulse overflow-hidden rounded-store border border-store-border bg-store-surface motion-reduce:animate-none">
      <div className="h-36 bg-store-surface-muted sm:h-44 md:h-52" />
      <div className="p-3">
        <div className="mb-1.5 h-2.5 w-1/3 rounded bg-store-surface-muted" />
        <div className="h-3.5 w-3/4 rounded bg-store-surface-muted" />
        <div className="mt-3 h-4 w-1/3 rounded bg-store-surface-muted" />
      </div>
    </div>
  );
}
