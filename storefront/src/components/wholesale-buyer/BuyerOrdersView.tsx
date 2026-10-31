import { PackageOpen } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { StoreContainer } from "@/components/layout/StoreContainer";
import { Button } from "@/components/ui/button";
import {
  type BuyerOrderDetail,
  type BuyerOrderSummary,
  formatBuyerMoney,
} from "@/lib/commerce/wholesale-buyer";
import type { BuyerOrdersResult } from "@/lib/data/wholesale-buyer";
import { CatalogAccessGate } from "./CatalogAccessGate";

type Props = { basePath: string; locale: Locale };

function when(iso: string | null, locale: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
}

/** Renders the refusal states shared by the list and the detail; returns `null` when the result is renderable data. */
async function Blocked({
  result,
  basePath,
  locale,
}: Props & { result: BuyerOrdersResult<unknown> }) {
  // `CatalogAccessGate` is an async server component: call it directly so this helper resolves to finished markup
  if (result.kind === "signed_out") {
    return CatalogAccessGate({ gate: "sign_in_required", basePath, locale });
  }
  if (result.kind === "not_approved") {
    return CatalogAccessGate({
      gate: "approval_required",
      membership: result.membership,
      basePath,
      locale,
    });
  }
  const t = await getTranslations({ locale, namespace: "wholesaleBuyer" });
  const notFound = result.kind === "not_found";
  return (
    <StoreContainer className="py-12 sm:py-16">
      <div
        className="mx-auto max-w-lg space-y-3 rounded-store border border-store-border bg-store-surface p-6 text-center"
        data-state={notFound ? "order-not-found" : "orders-unavailable"}
      >
        <h1 className="text-xl font-bold text-store-foreground">
          {notFound ? t("orders.notFoundTitle") : t("orders.unavailableTitle")}
        </h1>
        <p className="text-sm text-store-muted-foreground">
          {notFound ? t("orders.notFoundBody") : t("orders.unavailableBody")}
        </p>
        <Button asChild variant="outline">
          <Link href={`${basePath}/buyer/orders`}>
            {t("orders.backToList")}
          </Link>
        </Button>
      </div>
    </StoreContainer>
  );
}

export async function BuyerOrdersList({
  result,
  basePath,
  locale,
  page,
}: Props & {
  result: BuyerOrdersResult<{
    orders: BuyerOrderSummary[];
    page: number;
    lastPage: number;
  }>;
  page: number;
}) {
  if (result.kind !== "ok") {
    return Blocked({ result, basePath, locale });
  }
  const t = await getTranslations({ locale, namespace: "wholesaleBuyer" });
  const { orders, lastPage } = result.data;

  return (
    <StoreContainer className="py-8 sm:py-12">
      <div className="mx-auto max-w-3xl space-y-4" data-state="orders">
        <h1 className="text-xl font-bold text-store-foreground">
          {t("orders.title")}
        </h1>
        {orders.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-store border border-store-border bg-store-surface p-8 text-center">
            <PackageOpen
              aria-hidden="true"
              className="size-8 text-store-muted-foreground"
            />
            <p className="font-medium text-store-foreground">
              {t("orders.emptyTitle")}
            </p>
            <p className="text-sm text-store-muted-foreground">
              {t("orders.emptyBody")}
            </p>
            <Button asChild>
              <Link href={`${basePath}/products`}>
                {t("membership.browse")}
              </Link>
            </Button>
          </div>
        ) : (
          <ul className="divide-y divide-store-border rounded-store border border-store-border bg-store-surface">
            {orders.map((order) => (
              <li key={order.id}>
                <Link
                  href={`${basePath}/buyer/orders/${order.id}`}
                  className="flex items-center justify-between gap-3 p-4 hover:bg-store-muted"
                >
                  <span className="min-w-0">
                    <bdi className="block font-medium text-store-foreground">
                      {order.number}
                    </bdi>
                    <span className="block text-xs text-store-muted-foreground">
                      {when(order.createdAt, locale)} ·{" "}
                      {t(
                        order.status === "cancelled"
                          ? "orders.status.cancelled"
                          : "orders.status.confirmed",
                      )}
                    </span>
                  </span>
                  <span className="shrink-0 font-medium text-store-foreground">
                    {formatBuyerMoney(order.totalMinor, order.currency, locale)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {lastPage > 1 && (
          <nav
            aria-label={t("orders.pagination")}
            className="flex justify-between"
          >
            {page > 1 ? (
              <Button asChild variant="outline">
                <Link href={`${basePath}/buyer/orders?page=${page - 1}`}>
                  {t("orders.previous")}
                </Link>
              </Button>
            ) : (
              <span />
            )}
            {page < lastPage && (
              <Button asChild variant="outline">
                <Link href={`${basePath}/buyer/orders?page=${page + 1}`}>
                  {t("orders.next")}
                </Link>
              </Button>
            )}
          </nav>
        )}
      </div>
    </StoreContainer>
  );
}

export async function BuyerOrderDetailView({
  result,
  basePath,
  locale,
}: Props & { result: BuyerOrdersResult<BuyerOrderDetail> }) {
  if (result.kind !== "ok") {
    return Blocked({ result, basePath, locale });
  }
  const t = await getTranslations({ locale, namespace: "wholesaleBuyer" });
  const order = result.data;
  const money = (amount: number) =>
    formatBuyerMoney(amount, order.currency, locale);

  return (
    <StoreContainer className="py-8 sm:py-12">
      <div className="mx-auto max-w-3xl space-y-4" data-state="order-detail">
        <Button asChild variant="link" className="h-auto p-0">
          <Link href={`${basePath}/buyer/orders`}>
            {t("orders.backToList")}
          </Link>
        </Button>
        <h1 className="text-xl font-bold text-store-foreground">
          {t("orders.detailTitle")} <bdi>{order.number}</bdi>
        </h1>
        <p className="text-sm text-store-muted-foreground">
          {when(order.createdAt, locale)} ·{" "}
          {t(
            order.status === "cancelled"
              ? "orders.status.cancelled"
              : "orders.status.confirmed",
          )}
        </p>
        {order.status === "cancelled" && (
          <p className="rounded-store border border-store-border bg-store-surface p-3 text-sm">
            {t("orders.cancelledNote")}
          </p>
        )}

        <ul className="divide-y divide-store-border rounded-store border border-store-border bg-store-surface">
          {order.lines.map((line, index) => (
            <li
              key={`${line.name}-${index}`}
              className="flex items-start justify-between gap-3 p-4"
            >
              <span className="min-w-0">
                <bdi className="block font-medium text-store-foreground">
                  {line.name}
                </bdi>
                <span className="block text-xs text-store-muted-foreground">
                  {line.quantity} × {money(line.unitPriceMinor)}
                  {line.unitName ? ` · ${line.unitName}` : ""}
                </span>
              </span>
              <span className="shrink-0 font-medium text-store-foreground">
                {money(line.lineTotalMinor)}
              </span>
            </li>
          ))}
        </ul>

        <dl className="space-y-1 rounded-store border border-store-border bg-store-surface p-4 text-sm">
          {order.deliveryAmountMinor !== null &&
            order.deliveryAmountMinor > 0 && (
              <div className="flex justify-between">
                <dt>{t("orders.delivery")}</dt>
                <dd>{money(order.deliveryAmountMinor)}</dd>
              </div>
            )}
          <div className="flex justify-between font-bold">
            <dt>{t("orders.total")}</dt>
            <dd>{money(order.totalMinor)}</dd>
          </div>
        </dl>

        {(order.deliveryAddress || order.paymentMethodName) && (
          <dl className="space-y-2 rounded-store border border-store-border bg-store-surface p-4 text-sm">
            {order.deliveryAddress && (
              <div>
                <dt className="text-xs text-store-muted-foreground">
                  {t("orders.deliveryAddress")}
                </dt>
                <dd>
                  <bdi>{order.deliveryAddress}</bdi>
                </dd>
              </div>
            )}
            {order.paymentMethodName && (
              <div>
                <dt className="text-xs text-store-muted-foreground">
                  {t("orders.payment")}
                </dt>
                <dd>
                  <bdi>{order.paymentMethodName}</bdi>
                </dd>
              </div>
            )}
          </dl>
        )}
        <p className="text-xs text-store-muted-foreground">
          {t("orders.notPaidNote")}
        </p>
      </div>
    </StoreContainer>
  );
}
