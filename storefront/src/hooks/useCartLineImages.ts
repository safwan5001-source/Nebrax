"use client";

import { useEffect, useRef, useState } from "react";
import { getCartLineImages } from "@/lib/data/cart-media";

/**
 * Cart-line thumbnails, resolved from the catalogue for the product ids a cart
 * surface is currently rendering. See `getCartLineImages` for why this is not
 * part of the cart payload itself.
 *
 * Results are memoised per mount, so re-rendering the cart (a quantity change,
 * the drawer reopening) never re-requests an image it already has. Ids that
 * resolve to no image are remembered as resolved too — a product with no media
 * is an answer, not a retry.
 *
 * `enabled` lets a closed drawer skip the request entirely rather than fetching
 * imagery nobody is looking at.
 */
export function useCartLineImages(
  productIds: Array<string | null>,
  enabled = true,
): Record<string, string | null> {
  const [images, setImages] = useState<Record<string, string | null>>({});
  const resolvedRef = useRef<Set<string>>(new Set());

  const key = productIds.filter(Boolean).sort().join(",");

  useEffect(() => {
    if (!enabled) return;
    const wanted = key.split(",").filter(Boolean);
    const missing = wanted.filter((id) => !resolvedRef.current.has(id));
    if (missing.length === 0) return;

    let settled = false;
    for (const id of missing) resolvedRef.current.add(id);

    getCartLineImages(missing)
      .then((resolved) => {
        settled = true;
        setImages((previous) => ({ ...previous, ...resolved }));
      })
      .catch(() => {
        // A failed lookup leaves the placeholder in place. Nothing about the
        // cart's contents or availability depends on it.
        settled = true;
        for (const id of missing) resolvedRef.current.delete(id);
      });

    return () => {
      // An effect torn down before its request settles must release the ids it
      // claimed. Without this, React's development double-invoke marks every id
      // as resolved on the first pass and discards the only request, so the
      // second pass finds nothing missing and no image ever arrives — which is
      // exactly what left the order confirmation showing placeholders.
      if (!settled) {
        for (const id of missing) resolvedRef.current.delete(id);
      }
    };
  }, [key, enabled]);

  return images;
}
