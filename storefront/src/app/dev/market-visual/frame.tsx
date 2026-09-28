"use client";

import type { AbstractIntlMessages } from "next-intl";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { CartProvider } from "@/contexts/CartContext";

export function MarketVisualFrame({
  locale,
  messages,
  children,
}: {
  locale: "ar" | "en";
  messages: AbstractIntlMessages;
  children: ReactNode;
}) {
  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <CartProvider>{children}</CartProvider>
    </NextIntlClientProvider>
  );
}
