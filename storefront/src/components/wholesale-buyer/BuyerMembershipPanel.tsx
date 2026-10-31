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
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
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
  const [companyName, setCompanyName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [pending, startTransition] = useTransition();

  const apply = () => {
    setError(null);
    startTransition(async () => {
      // optional, unverified context for the store's reviewer — it decides nothing and grants nothing
      const result = await applyForWholesale({ companyName, contactPhone });
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
          <div className="space-y-3">
            <Field>
              <FieldLabel htmlFor="buyer-company">
                {t("membership.company")}
              </FieldLabel>
              <Input
                id="buyer-company"
                name="company_name"
                autoComplete="organization"
                maxLength={150}
                value={companyName}
                onChange={(event) => setCompanyName(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="buyer-phone">
                {t("membership.phone")}
              </FieldLabel>
              <Input
                id="buyer-phone"
                name="contact_phone"
                type="tel"
                dir="ltr"
                autoComplete="tel"
                inputMode="tel"
                maxLength={30}
                value={contactPhone}
                onChange={(event) => setContactPhone(event.target.value)}
              />
            </Field>
            <p className="text-xs text-store-muted-foreground">
              {t("membership.applicationHint")}
            </p>
            <Button
              type="button"
              className="w-full"
              onClick={apply}
              disabled={pending}
            >
              {pending ? t("membership.applying") : t("membership.apply")}
            </Button>
          </div>
        )}
        {canSeeWholesalePrices(state) && (
          <div className="space-y-2">
            <Button asChild className="w-full">
              <Link href={`${basePath}/products`}>
                {t("membership.browse")}
              </Link>
            </Button>
            <Button asChild variant="outline" className="w-full">
              <Link href={`${basePath}/buyer/quick-order`}>
                {t("membership.quickOrder")}
              </Link>
            </Button>
            <Button asChild variant="outline" className="w-full">
              <Link href={`${basePath}/buyer/orders`}>
                {t("membership.myOrders")}
              </Link>
            </Button>
          </div>
        )}
      </div>
    </AccountAuthCard>
  );
}
