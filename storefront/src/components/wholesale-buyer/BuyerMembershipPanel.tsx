"use client";

import { CircleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { AccountAuthCard } from "@/components/account/AccountAuthCard";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  type BuyerAccessState,
  canApply,
  canSeeWholesalePrices,
} from "@/lib/commerce/wholesale-buyer";
import { applyForWholesale, signOutBuyer } from "@/lib/data/wholesale-buyer";

/**
 * The buyer's standing on this wholesale host (H6 Batch G): sign-in prompt, apply,
 * pending, approved, rejected, suspended, or "not offered here". The state comes
 * from the API (`wholesale/membership`) — nothing is inferred client-side, and
 * the only action that changes it is the buyer's own application; approval is a
 * staff decision.
 */
export function BuyerMembershipPanel({
  state,
  displayName,
  basePath,
}: {
  state: BuyerAccessState;
  displayName: string | null;
  basePath: string;
}) {
  const t = useTranslations("wholesaleBuyer");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const apply = () => {
    setError(null);
    startTransition(async () => {
      const result = await applyForWholesale();
      if (result.success) router.refresh();
      else setError(t(`errors.${result.error}`));
    });
  };

  const signOut = () => {
    startTransition(async () => {
      await signOutBuyer();
      router.push(`${basePath}/buyer/sign-in`);
      router.refresh();
    });
  };

  const badgeVariant = canSeeWholesalePrices(state) ? "default" : "secondary";

  return (
    <AccountAuthCard
      title={t("membership.title")}
      description={
        displayName
          ? t("membership.signedInAs", { name: displayName })
          : undefined
      }
      footer={
        state !== "signed_out" && state !== "unavailable" ? (
          <Button
            type="button"
            variant="link"
            className="h-auto p-0"
            onClick={signOut}
            disabled={pending}
          >
            {t("membership.signOut")}
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-4" data-state={state}>
        <div className="flex items-center gap-2">
          <Badge variant={badgeVariant}>{t(`status.${state}.label`)}</Badge>
        </div>
        <p className="text-sm leading-relaxed text-store-foreground">
          {t(`status.${state}.body`)}
        </p>
        {error && (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {state === "signed_out" && (
          <Button asChild className="w-full">
            <Link href={`${basePath}/buyer/sign-in`}>{t("signIn.submit")}</Link>
          </Button>
        )}
        {canApply(state) && (
          <Button
            type="button"
            className="w-full"
            onClick={apply}
            disabled={pending}
          >
            {pending ? t("membership.applying") : t("membership.apply")}
          </Button>
        )}
        {canSeeWholesalePrices(state) && (
          <Button asChild className="w-full">
            <Link href={`${basePath}/products`}>{t("membership.browse")}</Link>
          </Button>
        )}
      </div>
    </AccountAuthCard>
  );
}
