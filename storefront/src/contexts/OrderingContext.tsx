"use client";

import { createContext, type ReactNode, useContext } from "react";
import type { AwjOrdering } from "@/lib/commerce/ordering";

/**
 * COPS-H4 Buyer Ordering UX — hands the server-read `data.ordering` block (parsed once in the storefront layout) to the
 * client surfaces that explain it (cart, checkout summary). `null` ⇒ the deployment gate is closed or the block was
 * absent/malformed ⇒ those surfaces render exactly what they did before. Read-only and informational: Checkout on the
 * server is the only authority on whether an order is accepted.
 */
const OrderingContext = createContext<AwjOrdering | null>(null);

export function OrderingProvider({
  ordering,
  children,
}: {
  ordering: AwjOrdering | null;
  children: ReactNode;
}) {
  return (
    <OrderingContext.Provider value={ordering}>
      {children}
    </OrderingContext.Provider>
  );
}

export function useOrdering(): AwjOrdering | null {
  return useContext(OrderingContext);
}
