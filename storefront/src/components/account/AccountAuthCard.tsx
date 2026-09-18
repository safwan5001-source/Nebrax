"use client";

import type { ReactNode } from "react";
import { StoreContainer } from "@/components/layout/StoreContainer";

/**
 * Shared chrome for sign-in / register / recovery. One card, store tokens,
 * no shadcn marketing Card stack. On a wide canvas it sits in the visual
 * middle of the remaining viewport so a compact form does not look lost
 * at the top of the page.
 */
export function AccountAuthCard({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <StoreContainer className="py-10 sm:py-16 lg:flex lg:min-h-[calc(100vh-10rem)] lg:items-center lg:py-12">
      <div className="mx-auto w-full max-w-lg">
        <div className="rounded-store border border-store-border bg-store-surface p-6 sm:p-8">
          <header>
            <h1 className="text-xl font-bold text-store-foreground">{title}</h1>
            {description && (
              <p className="mt-2 text-sm leading-relaxed text-store-muted-foreground">
                {description}
              </p>
            )}
          </header>
          {children ? <div className="mt-6">{children}</div> : null}
          {footer && (
            <div className="mt-6 border-t border-store-border pt-4 text-sm text-store-muted-foreground">
              {footer}
            </div>
          )}
        </div>
      </div>
    </StoreContainer>
  );
}
