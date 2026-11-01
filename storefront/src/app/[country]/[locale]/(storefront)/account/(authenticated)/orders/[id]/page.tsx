import { AccountOrderDetailView } from "@/components/account/AccountOrdersView";
import { OrdersUnavailable } from "@/components/account/OrdersUnavailable";
import { getOrder } from "@/lib/data/customer";

interface OrderDetailPageProps {
  params: Promise<{ country: string; locale: string; id: string }>;
}

/**
 * One of the signed-in customer's own orders. Ownership is the API's: `GET account/orders/{id}` answers one identical 404
 * for an order that does not exist, belongs to someone else, or belongs to another store — so a guessed id reveals
 * nothing. The page never decides who owns what.
 */
export default async function OrderDetailPage({
  params,
}: OrderDetailPageProps) {
  const { country, locale, id } = await params;
  const basePath = `/${country}/${locale}`;
  const result = await getOrder(id);

  if (result.kind !== "ok") {
    return (
      <OrdersUnavailable
        basePath={basePath}
        signedOut={result.kind === "signed_out"}
        notFound={result.kind === "not_found"}
      />
    );
  }

  return <AccountOrderDetailView order={result.data} basePath={basePath} />;
}
