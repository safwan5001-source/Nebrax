"use client";

import type { Product } from "@spree/sdk";
import { usePublishedThemeMarker } from "@/components/layout/PublishedThemeMarker";
import { cn } from "@/lib/utils";
import { ProductCard } from "./ProductCard";

interface ProductGridProps {
  products: Product[];
  basePath?: string;
  categoryId?: string;
  listId?: string;
  listName?: string;
  emptyMessage?: string;
  priorityCount?: number;
  /** Optional currency used for analytics in each ProductCard. */
  currency?: string;
}

export function ProductGrid({
  products,
  basePath = "",
  categoryId,
  listId,
  listName,
  emptyMessage,
  priorityCount = 0,
  currency,
}: ProductGridProps) {
  const isMarket = usePublishedThemeMarker() === "awj-market";

  if (products.length === 0 && emptyMessage) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "grid gap-4 md:gap-5",
        isMarket
          ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
          : "grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
      )}
    >
      {products.map((product, index) => (
        <ProductCard
          key={product.id}
          product={product}
          basePath={basePath}
          categoryId={categoryId}
          index={index}
          listId={listId}
          listName={listName}
          fetchPriority={index < priorityCount ? "high" : undefined}
          currency={currency}
        />
      ))}
    </div>
  );
}
