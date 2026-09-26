"use client";

import type { AbstractIntlMessages } from "next-intl";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { PublishedCardStyleProvider } from "@/components/layout/PublishedCardStyle";
import { CartProvider } from "@/contexts/CartContext";

export function PublishedFrame({
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
      <PublishedCardStyleProvider productCard="standard">
        <CartProvider>{children}</CartProvider>
      </PublishedCardStyleProvider>
    </NextIntlClientProvider>
  );
}
