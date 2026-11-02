"use client";

import { useLocale, useTranslations } from "next-intl";
import { ACCOUNT_ORDER_STATUS_CAPABILITY } from "@/lib/commerce/capabilities";
import type { StorefrontFulfillment } from "@/lib/commerce/checkout-types";
import { cn } from "@/lib/utils";

const STEPS = [
  { key: "placed", authoritativeWhen: "confirmed" },
  { key: "preparing", authoritativeWhen: null },
  { key: "onTheWay", authoritativeWhen: null },
  { key: "delivered", authoritativeWhen: null },
] as const;

type StepKey =
  | "placed"
  | "preparing"
  | "readyForPickup"
  | "onTheWay"
  | "delivered"
  | "pickedUp";

/** Steps per fulfilment type — pickup swaps the last two for ready/picked-up. */
const DELIVERY_STEPS: StepKey[] = [
  "placed",
  "preparing",
  "onTheWay",
  "delivered",
];
const PICKUP_STEPS: StepKey[] = [
  "placed",
  "preparing",
  "readyForPickup",
  "pickedUp",
];

/**
 * How far along the journey a public stage is (index into the type's steps). `delivery_attempt_failed` keeps the
 * "on the way" step lit (it was dispatched) and adds a notice — it never reads as delivered.
 */
function reachedIndex(f: StorefrontFulfillment): number {
  if (f.type === "pickup") {
    return { preparing: 1, ready: 2, picked_up: 3 }[f.stage as string] ?? 1;
  }
  return (
    {
      preparing: 1,
      ready: 1,
      out_for_delivery: 2,
      delivery_attempt_failed: 2,
      delivered: 3,
    }[f.stage as string] ?? 1
  );
}

function formatAt(
  value: string | null | undefined,
  locale: string,
): string | null {
  if (!value) return null;
  try {
    return new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return null;
  }
}

/** When the buyer-visible stage behind a step was reached (from the API's `stages`), if it said. */
function stepTime(f: StorefrontFulfillment, step: StepKey, locale: string) {
  const key = {
    placed: "placed",
    preparing: "preparing",
    readyForPickup: "ready",
    onTheWay: "out_for_delivery",
    delivered: "delivered",
    pickedUp: "picked_up",
  }[step];
  return formatAt(f.stages.find((s) => s.key === key)?.at, locale);
}

/**
 * Intended order-status presentation — a single journey, not a grid of
 * badges.
 *
 * **GATED (COPS-H2-4).** Steps past "placed" light up **only** from the API's
 * `fulfillment` block — never from `status`, which stays `draft | confirmed`.
 * Without that block (the store does not use fulfilment, or none has started)
 * the order is exactly as before: only "placed" may light up, and only when
 * the authoritative status is `confirmed`; unavailable tracking is stated once,
 * under the journey. The connecting line is never filled — that would fake
 * progress. A failed delivery attempt is a neutral notice: no reason, no count.
 */
export function AccountOrderStatus({
  status,
  cancelledDate = null,
  fulfillment = null,
}: {
  status: string;
  /** Pre-formatted (locale-aware) cancellation date; `null` when the API gave none. */
  cancelledDate?: string | null;
  /** COPS-H2-4 — the public fulfilment block, if the API sent one. */
  fulfillment?: StorefrontFulfillment | null;
}) {
  const t = useTranslations("orders");
  const locale = useLocale();
  const live = ACCOUNT_ORDER_STATUS_CAPABILITY === "live";

  // O3c: a cancelled order is terminal. It must never read as placed / being
  // prepared / on its way, so the journey is replaced by a notice. The notice
  // makes no payment or refund claim.
  if (status === "cancelled") {
    const date = cancelledDate;
    return (
      <section
        aria-labelledby="account-order-status"
        role="status"
        className="rounded-store border border-store-border-strong bg-store-surface-muted p-4"
      >
        <h2
          id="account-order-status"
          className="text-sm font-semibold text-store-foreground"
        >
          {t("cancelled.title")}
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-store-foreground">
          {date ? t("cancelled.body", { date }) : t("cancelled.bodyNoDate")}
        </p>
        <p className="mt-2 text-xs leading-relaxed text-store-muted-foreground">
          {t("cancelled.detail")}
        </p>
      </section>
    );
  }

  if (fulfillment) {
    const steps = fulfillment.type === "pickup" ? PICKUP_STEPS : DELIVERY_STEPS;
    const reached = reachedIndex(fulfillment);
    const failed = fulfillment.stage === "delivery_attempt_failed";
    const tracking = fulfillment.tracking;
    const showTracking =
      tracking !== null &&
      (tracking.carrier || tracking.number || tracking.url);
    const readyAt = formatAt(fulfillment.pickup?.readyAt, locale);

    return (
      <section
        aria-labelledby="account-order-status"
        data-fulfillment-stage={fulfillment.stage}
      >
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
            {steps.map((step, index) => {
              const lit = index <= reached;
              const current = index === reached && !failed;
              const at = lit ? stepTime(fulfillment, step, locale) : null;
              return (
                <li
                  key={step}
                  aria-current={current ? "step" : undefined}
                  className="relative flex flex-col items-center px-0.5 text-center sm:px-1"
                >
                  <span
                    className={cn(
                      "relative z-10 size-2.5 rounded-full",
                      lit
                        ? "bg-store-primary"
                        : "border border-store-border-strong bg-store-surface",
                    )}
                  />
                  <p
                    className={cn(
                      "mt-2 text-[0.6875rem] leading-snug sm:text-sm",
                      lit
                        ? "font-semibold text-store-foreground"
                        : "text-store-muted-foreground",
                    )}
                  >
                    {t(`timeline.${step}`)}
                  </p>
                  {at && (
                    <p className="mt-0.5 text-[0.625rem] leading-snug text-store-muted-foreground sm:text-xs">
                      <bdi>{at}</bdi>
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
        {failed && (
          <div
            role="status"
            className="mt-4 rounded-store border border-store-border-strong bg-store-surface-muted p-3"
          >
            <p className="text-sm font-semibold text-store-foreground">
              {t("timeline.attemptFailedTitle")}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-store-muted-foreground">
              {t("timeline.attemptFailedBody")}
            </p>
          </div>
        )}
        {fulfillment.type === "pickup" &&
          fulfillment.stage === "ready" &&
          readyAt && (
            <p className="mt-3 text-xs leading-relaxed text-store-muted-foreground">
              {t("timeline.pickupReady", { date: readyAt })}
            </p>
          )}
        {showTracking && (
          <div className="mt-4 rounded-store border border-store-border p-3 text-sm">
            <p className="font-semibold text-store-foreground">
              {t("timeline.trackingTitle")}
            </p>
            <dl className="mt-1 space-y-0.5 text-store-muted-foreground">
              {tracking.carrier && (
                <div className="flex gap-2">
                  <dt>{t("timeline.trackingCarrier")}</dt>
                  <dd className="text-store-foreground">
                    <bdi>{tracking.carrier}</bdi>
                  </dd>
                </div>
              )}
              {tracking.number && (
                <div className="flex gap-2">
                  <dt>{t("timeline.trackingNumber")}</dt>
                  <dd className="text-store-foreground">
                    <bdi dir="ltr">{tracking.number}</bdi>
                  </dd>
                </div>
              )}
            </dl>
            {tracking.url && (
              <a
                href={tracking.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-store-primary underline underline-offset-2"
              >
                {t("timeline.trackingOpen")}
              </a>
            )}
          </div>
        )}
      </section>
    );
  }

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
