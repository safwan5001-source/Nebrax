"use client";

import { createContext, type ReactNode, useContext } from "react";

const PublishedCardStyleContext = createContext<"standard" | "compact">(
  "standard",
);

export function PublishedCardStyleProvider({
  productCard,
  children,
}: {
  productCard: "standard" | "compact";
  children: ReactNode;
}) {
  return (
    <PublishedCardStyleContext.Provider value={productCard}>
      {children}
    </PublishedCardStyleContext.Provider>
  );
}

export function usePublishedProductCard(): "standard" | "compact" {
  return useContext(PublishedCardStyleContext);
}
