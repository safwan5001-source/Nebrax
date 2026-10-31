"use client";

import { ChevronLeft, ChevronRight, ShoppingBag } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";
import { AccountEmptyState } from "@/components/account/AccountEmptyState";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { localeDirection } from "@/i18n/locales";
import {
  type BuyerOrderDetail,
  type BuyerOrderSummary,
  formatBuyerMoney,
} from "@/lib/commerce/wholesale-buyer";
import { claimOrder } from "@/lib/data/customer";
import { AccountOrderStatus } from "./AccountOrderStatus";

function when(
  value: string | null,
  locale: string,
  long = false,
): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: long ? "long" : "short",
    day: "numeric",
  }).format(date);
}

function useStatusLabel() {
  const t = useTranslations("orders");
  return (status: string) =>
    status === "confirmed"
      ? t("statusConfirmed")
      : status === "draft"
        ? t("statusDraft")
        : status === "cancelled"
          ? t("statusCancelled")
          : status;
}

/**
 * The signed-in customer's own order history. Rows come from the server's ownership-scoped list; this component never
 * receives, builds or sends an owner id. Includes the guest-order "link to my account" form, whose proof is checked by
 * the API (signed reference or verified e-mail) — a failure is deliberately one neutral message.
 */
export function AccountOrdersView({
  orders,
  basePath,
  page,
  lastPage,
}: {
  orders: BuyerOrderSummary[];
  basePath: string;
  page: number;
  lastPage: number;
}) {
  const t = useTranslations("orders");
  const tr = useTranslations("retailAccount");
  const locale = useLocale();
  const statusLabel = useStatusLabel();
  const Chevron =
    localeDirection(locale) === "rtl" ? ChevronLeft : ChevronRight;

  return (
    <div>
      <h1 className="text-xl font-bold text-store-foreground">
        {t("orderHistory")}
      </h1>

      {orders.length === 0 ? (
        <div className="mt-5">
          <AccountEmptyState
            icon={ShoppingBag}
            title={t("noOrders")}
            description={t("noOrdersDescription")}
            actionHref={`${basePath}/products`}
            actionLabel={t("startShopping")}
          />
        </div>
      ) : (
        <ul
          className="mt-5 divide-y divide-store-border overflow-hidden rounded-store border border-store-border bg-store-surface"
          data-testid="account-orders"
        >
          {orders.map((order) => {
            const date = when(order.createdAt, locale);
            return (
              <li key={order.id}>
                <Link
                  href={`${basePath}/account/orders/${order.id}`}
                  className="flex min-h-11 items-center gap-3 px-4 py-3 transition-colors hover:bg-store-surface-muted"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-store-foreground">
                      <bdi>{order.number}</bdi>
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-store-muted-foreground">
                      {date && <span>{date}</span>}
                      <span>{statusLabel(order.status)}</span>
                    </p>
                  </div>
                  <p className="shrink-0 text-sm font-semibold tabular-nums text-store-foreground">
                    <bdi>
                      {formatBuyerMoney(
                        order.totalMinor,
                        order.currency,
                        locale,
                      )}
                    </bdi>
                  </p>
                  <Chevron
                    className="size-4 shrink-0 text-store-muted-foreground"
                    aria-hidden="true"
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {lastPage > 1 && (
        <nav
          className="mt-4 flex items-center justify-between gap-3"
          aria-label={tr("pagination")}
        >
          {page > 1 ? (
            <Link
              className="min-h-11 content-center text-sm font-medium text-store-primary"
              href={`${basePath}/account/orders?page=${page - 1}`}
            >
              {tr("previousPage")}
            </Link>
          ) : (
            <span />
          )}
          <span className="text-xs text-store-muted-foreground">
            {tr("pageOf", { page, total: lastPage })}
          </span>
          {page < lastPage ? (
            <Link
              className="min-h-11 content-center text-sm font-medium text-store-primary"
              href={`${basePath}/account/orders?page=${page + 1}`}
            >
              {tr("nextPage")}
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}

      <ClaimOrderForm />
    </div>
  );
}

function ClaimOrderForm() {
  const tr = useTranslations("retailAccount");
  const [number, setNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    kind: "ok" | "error";
    text: string;
  } | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage(null);
    setBusy(true);
    const result = await claimOrder({ orderNumber: number });
    if (result.kind === "ok") {
      setMessage({
        kind: "ok",
        text: tr("claimLinked", { number: result.data.number }),
      });
      setNumber("");
      // The new order must appear in the list above: re-render the server data.
      window.location.reload();
      return;
    }
    setMessage({
      kind: "error",
      text:
        result.kind === "signed_out" ? tr("claimSignedOut") : tr("claimFailed"),
    });
    setBusy(false);
  };

  return (
    <section
      aria-labelledby="claim-heading"
      className="mt-8 border-t border-store-border pt-6"
      data-testid="claim-order"
    >
      <h2
        id="claim-heading"
        className="text-base font-semibold text-store-foreground"
      >
        {tr("claimTitle")}
      </h2>
      <p className="mt-1 text-sm text-store-muted-foreground">
        {tr("claimBody")}
      </p>
      <form onSubmit={submit} className="mt-4 space-y-3">
        {message && (
          <Alert
            variant={message.kind === "error" ? "destructive" : "default"}
            role={message.kind === "error" ? "alert" : "status"}
          >
            <AlertDescription>{message.text}</AlertDescription>
          </Alert>
        )}
        <Field>
          <FieldLabel htmlFor="claim-order-number">
            {tr("claimOrderNumber")}
          </FieldLabel>
          <Input
            id="claim-order-number"
            name="order_number"
            dir="ltr"
            autoComplete="off"
            value={number}
            onChange={(event) => setNumber(event.target.value)}
            maxLength={64}
            required
            placeholder="CORD-…"
          />
        </Field>
        <Button
          type="submit"
          variant="outline"
          size="lg"
          className="w-full sm:w-auto"
          disabled={busy || number.trim() === ""}
        >
          {busy ? tr("claiming") : tr("claimAction")}
        </Button>
      </form>
    </section>
  );
}

export function AccountOrderDetailView({
  order,
  basePath,
}: {
  order: BuyerOrderDetail;
  basePath: string;
}) {
  const t = useTranslations("orders");
  const tc = useTranslations("common");
  const locale = useLocale();
  const statusLabel = useStatusLabel();
  const BackChevron =
    localeDirection(locale) === "rtl" ? ChevronRight : ChevronLeft;
  const money = (minor: number) =>
    formatBuyerMoney(minor, order.currency, locale);
  const placed = when(order.createdAt, locale, true);

  return (
    <div data-testid="account-order-detail">
      <Link
        href={`${basePath}/account/orders`}
        className="mb-3 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-store-muted-foreground hover:text-store-foreground"
      >
        <BackChevron className="size-4" aria-hidden="true" />
        {t("backToOrders")}
      </Link>

      <header className="lg:border-b lg:border-store-border lg:pb-5">
        <p className="text-xs font-medium text-store-muted-foreground">
          {t("order")}
        </p>
        <h1 className="mt-1 text-xl font-bold text-store-foreground lg:text-2xl">
          <bdi>{order.number}</bdi>
        </h1>
        <p className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-sm text-store-muted-foreground">
          {placed && <span>{t("placedOn", { date: placed })}</span>}
          <span>{statusLabel(order.status)}</span>
        </p>
      </header>

      <div className="mt-6">
        <AccountOrderStatus
          status={order.status}
          cancelledDate={when(order.cancelledAt, locale, true)}
        />
      </div>

      <section
        aria-labelledby="account-order-items"
        className="mt-6 border-t border-store-border pt-5"
      >
        <h2
          id="account-order-items"
          className="text-sm font-semibold text-store-foreground"
        >
          {t("orderItems")}
        </h2>
        <ul className="mt-1 divide-y divide-store-border">
          {order.lines.map((line, index) => (
            <li
              key={`${line.name}-${index}`}
              className="flex items-start justify-between gap-3 py-3 text-sm"
            >
              <div className="min-w-0">
                <p className="font-medium text-store-foreground">{line.name}</p>
                <p className="text-xs text-store-muted-foreground">
                  {line.unitName ? `${line.unitName} · ` : ""}
                  {t("qty")}: <bdi>{line.quantity}</bdi>
                </p>
              </div>
              <p className="shrink-0 tabular-nums text-store-foreground">
                <bdi>{money(line.lineTotalMinor)}</bdi>
              </p>
            </li>
          ))}
        </ul>
        {order.deliveryAmountMinor !== null &&
          order.deliveryAmountMinor > 0 && (
            <div className="flex items-baseline justify-between border-t border-store-border py-3 text-sm">
              <span className="text-store-muted-foreground">
                {tc("shipping")}
              </span>
              <span className="tabular-nums">
                <bdi>{money(order.deliveryAmountMinor)}</bdi>
              </span>
            </div>
          )}
        <div className="flex items-baseline justify-between border-t border-store-border py-4">
          <span className="text-sm font-semibold text-store-foreground">
            {tc("total")}
          </span>
          <span className="text-lg font-bold tabular-nums text-store-foreground">
            <bdi>{money(order.totalMinor)}</bdi>
          </span>
        </div>
      </section>

      {order.deliveryAddress && (
        <section className="mt-6 border-t border-store-border pt-5">
          <h2 className="text-xs font-semibold text-store-muted-foreground">
            {t("deliveryAddress")}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-store-foreground">
            {order.deliveryAddress}
          </p>
        </section>
      )}
    </div>
  );
}
