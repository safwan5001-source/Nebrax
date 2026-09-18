"use client";

import type { ReactNode } from "react";
import { StoreContainer } from "@/components/layout/StoreContainer";

/**
 * Shared chrome for sign-in / register / recovery. One card, store tokens,
 * no shadcn marketing Card stack.
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
    <StoreContainer className="py-10 sm:py-16">
      <div className="mx-auto w-full max-w-md">
        <div className="rounded-store border border-store-border bg-store-surface p-6 sm:p-8">
          <header className="text-center">
            <h1 className="text-xl font-bold text-store-foreground sm:text-2xl">
              {title}
            </h1>
            {description && (
              <p className="mt-2 text-sm leading-relaxed text-store-muted-foreground">
                {description}
              </p>
            )}
          </header>
          {children ? <div className="mt-6">{children}</div> : null}
          {footer && (
            <div className="mt-6 border-t border-store-border pt-4 text-center text-sm text-store-muted-foreground">
              {footer}
            </div>
          )}
        </div>
      </div>
    </StoreContainer>
  );
}
