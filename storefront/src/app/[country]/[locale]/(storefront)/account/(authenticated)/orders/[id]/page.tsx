import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AccountGatedNotice } from "@/components/account/AccountGatedNotice";
import { ACCOUNT_ORDER_LOOKUP_CAPABILITY } from "@/lib/commerce/capabilities";

interface OrderDetailPageProps {
  params: Promise<{
    country: string;
    locale: string;
    id: string;
  }>;
}

/**
 * AWJ DTC order detail. There is no `GET store/v1/account/orders/{id}`,
 * so this route does not call Spree `orders.get`. The designed
 * `AccountOrderDetail` surface lights up when that contract lands.
 */
export default async function OrderDetailPage({
  params,
}: OrderDetailPageProps) {
  const { country, locale } = await params;
  const t = await getTranslations({
    locale: locale as Locale,
    namespace: "orders",
  });
  const basePath = `/${country}/${locale}`;
  const unavailable = ACCOUNT_ORDER_LOOKUP_CAPABILITY !== "live";

  return (
    <div>
      <h1 className="text-xl font-bold text-store-foreground sm:text-2xl">
        {t("orderNotFound")}
      </h1>
      {unavailable && (
        <div className="mt-4">
          <AccountGatedNotice
            title={t("lookupUnavailableTitle")}
            body={t("lookupUnavailableBody")}
          />
        </div>
      )}
      <p className="mt-4 text-sm text-store-muted-foreground">
        {t("orderNotFoundDescription")}
      </p>
      <Link
        href={`${basePath}/account/orders`}
        className="mt-6 inline-flex min-h-11 items-center text-sm font-medium text-store-primary hover:text-store-primary-hover"
      >
        {t("backToOrders")}
      </Link>
    </div>
  );
}
