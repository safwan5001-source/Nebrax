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
 * Intended order-status presentation — a single journey, not a grid of
 * badges.
 *
 * **DESIGN_ONLY.** `CommerceOrder.status` is `draft | confirmed`. Later
 * steps are the shape of a fulfilment timeline, not a claim that this
 * order has been shipped. Only "placed" may light up, and only when the
 * authoritative status is `confirmed`. Unavailable tracking is stated
 * once, under the journey, never repeated on every step. The connecting
 * line is never filled — that would fake progress.
 */
export function AccountOrderStatus({ status }: { status: string }) {
  const t = useTranslations("orders");
  const live = ACCOUNT_ORDER_STATUS_CAPABILITY === "live";

  return (
    <section aria-labelledby="account-order-status">
      <h2
        id="account-order-status"
        className="text-sm font-semibold text-store-foreground"
      >
        {t("timelineTitle")}
      </h2>
      <div className="relative mt-4">
        <div
          aria-hidden="true"
          className="absolute start-[12.5%] end-[12.5%] top-[5px] h-px bg-store-border"
        />
        <ol className="grid grid-cols-4">
          {STEPS.map((step) => {
            const reached =
              live ||
              (step.authoritativeWhen !== null &&
                status === step.authoritativeWhen);
            return (
              <li
                key={step.key}
                className="relative flex flex-col items-center px-0.5 text-center sm:px-1"
              >
                <span
                  className={cn(
                    "relative z-10 size-2.5 rounded-full",
                    reached
                      ? "bg-store-primary"
                      : "border border-store-border-strong bg-store-surface",
                  )}
                />
                <p
                  className={cn(
                    "mt-2 text-[0.6875rem] leading-snug sm:text-sm",
                    reached
                      ? "font-semibold text-store-foreground"
                      : "text-store-muted-foreground",
                  )}
                >
                  {t(`timeline.${step.key}`)}
                </p>
              </li>
            );
          })}
        </ol>
      </div>
      {ACCOUNT_ORDER_STATUS_CAPABILITY !== "live" && (
        <p className="mt-3 text-xs leading-relaxed text-store-muted-foreground">
          {t("timeline.caption")}
        </p>
      )}
    </section>
  );
}
