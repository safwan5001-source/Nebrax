"use client";

import { useTranslations } from "next-intl";
import { ACCOUNT_ORDER_STATUS_CAPABILITY } from "@/lib/commerce/capabilities";
import { cn } from "@/lib/utils";

const STEPS = [
  { key: "placed", authoritativeWhen: "confirmed" },
  { key: "preparing", authoritativeWhen: null },
  { key: "onTheWay", authoritativeWhen: null },
  { key: "delivered", authoritativeWhen: null },
] as const;

/**
 * Intended order-status presentation.
 *
 * **DESIGN_ONLY.** `CommerceOrder.status` is `draft | confirmed`. Later
 * steps are the shape of a fulfilment timeline, not a claim that this
 * order has been shipped. Only "placed" may light up, and only when the
 * authoritative status is `confirmed`.
 */
export function AccountOrderStatus({ status }: { status: string }) {
  const t = useTranslations("orders");
  const live = ACCOUNT_ORDER_STATUS_CAPABILITY === "live";

  return (
    <section
      aria-labelledby="account-order-status"
      className="rounded-store border border-store-border bg-store-surface p-5"
    >
      <h2
        id="account-order-status"
        className="text-sm font-bold text-store-foreground"
      >
        {t("timelineTitle")}
      </h2>
      <ol className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {STEPS.map((step, index) => {
          const reached =
            live ||
            (step.authoritativeWhen !== null &&
              status === step.authoritativeWhen);
          return (
            <li key={step.key} className="min-w-0">
              <p
                className={cn(
                  "text-[0.6875rem] font-semibold tabular-nums",
                  reached
                    ? "text-store-primary"
                    : "text-store-muted-foreground",
                )}
              >
                {index + 1}
              </p>
              <p
                className={cn(
                  "mt-1 text-sm font-medium leading-snug",
                  reached
                    ? "text-store-foreground"
                    : "text-store-muted-foreground",
                )}
              >
                {t(`timeline.${step.key}`)}
              </p>
              {!reached && (
                <p className="mt-0.5 text-xs text-store-muted-foreground">
                  {t("timeline.notTracked")}
                </p>
              )}
            </li>
          );
        })}
      </ol>
      <p className="mt-4 text-xs leading-relaxed text-store-muted-foreground">
        {t("timeline.caption")}
      </p>
    </section>
  );
}
