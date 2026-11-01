import Link from "next/link";
import { getTranslations } from "next-intl/server";

/** Shared refusal state for the order pages: signed out (sign in again) or a plain "could not load" — no internals. */
export async function OrdersUnavailable({
  basePath,
  signedOut,
  notFound = false,
}: {
  basePath: string;
  signedOut: boolean;
  notFound?: boolean;
}) {
  const t = await getTranslations("retailAccount");
  const to = await getTranslations("orders");

  return (
    <div
      data-state={
        signedOut
          ? "signed-out"
          : notFound
            ? "order-not-found"
            : "orders-unavailable"
      }
    >
      <h1 className="text-xl font-bold text-store-foreground sm:text-2xl">
        {signedOut
          ? t("sessionEndedTitle")
          : notFound
            ? to("orderNotFound")
            : t("ordersUnavailableTitle")}
      </h1>
      <p className="mt-4 text-sm text-store-muted-foreground">
        {signedOut
          ? t("sessionEndedBody")
          : notFound
            ? to("orderNotFoundDescription")
            : t("ordersUnavailableBody")}
      </p>
      <Link
        href={signedOut ? `${basePath}/account` : `${basePath}/account/orders`}
        className="mt-6 inline-flex min-h-11 items-center text-sm font-medium text-store-primary hover:text-store-primary-hover"
      >
        {signedOut ? t("signInAgain") : to("backToOrders")}
      </Link>
    </div>
  );
}
