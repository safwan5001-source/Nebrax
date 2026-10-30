import { Lock } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { StoreContainer } from "@/components/layout/StoreContainer";
import { Button } from "@/components/ui/button";
import type { CatalogGate } from "@/lib/commerce/wholesale-buyer";

/**
 * Shown instead of a price-bearing catalogue page when the API refuses it for a
 * wholesale channel (H6 Batch G): 401 → sign in; 403 → approval required.
 * No product, name or price is rendered here, and DTC hosts never reach it (the
 * API never answers 401/403 for them).
 */
export async function CatalogAccessGate({
  gate,
  basePath,
  locale,
}: {
  gate: CatalogGate;
  basePath: string;
  locale: Locale;
}) {
  const t = await getTranslations({ locale, namespace: "wholesaleBuyer" });
  const isSignIn = gate === "sign_in_required";

  return (
    <StoreContainer className="py-12 sm:py-16">
      <div
        className="mx-auto flex w-full max-w-lg flex-col items-center gap-4 rounded-store border border-store-border bg-store-surface p-6 text-center sm:p-8"
        data-gate={gate}
      >
        <Lock aria-hidden="true" className="size-8 text-store-primary" />
        <h1 className="text-xl font-bold text-store-foreground">
          {t(`gate.${gate}.title`)}
        </h1>
        <p className="text-sm leading-relaxed text-store-muted-foreground">
          {t(`gate.${gate}.body`)}
        </p>
        <Button asChild className="w-full sm:w-auto">
          <Link
            href={`${basePath}/buyer/${isSignIn ? "sign-in" : "membership"}`}
          >
            {t(`gate.${gate}.cta`)}
          </Link>
        </Button>
      </div>
    </StoreContainer>
  );
}
