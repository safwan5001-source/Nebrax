import { AccountOrderList } from "@/components/account/AccountOrderList";
import { ACCOUNT_ORDER_HISTORY_CAPABILITY } from "@/lib/commerce/capabilities";

interface OrdersPageProps {
  params: Promise<{ country: string; locale: string }>;
}

/**
 * AWJ DTC order history. `store/v1` has no customer order-list route, so
 * this page does not call Spree `customer.orders.list` — that would present
 * another backend's payment/fulfilment vocabulary as AWJ order truth.
 */
export default async function OrdersPage({ params }: OrdersPageProps) {
  const { country, locale } = await params;
  const basePath = `/${country}/${locale}`;
  const lookupUnavailable = ACCOUNT_ORDER_HISTORY_CAPABILITY !== "live";

  return (
    <AccountOrderList
      orders={[]}
      basePath={basePath}
      lookupUnavailable={lookupUnavailable}
    />
  );
}
