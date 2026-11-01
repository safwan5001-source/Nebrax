import { AccountOrdersView } from "@/components/account/AccountOrdersView";
import { OrdersUnavailable } from "@/components/account/OrdersUnavailable";
import { listOrders } from "@/lib/data/customer";

interface OrdersPageProps {
  params: Promise<{ country: string; locale: string }>;
  searchParams: Promise<{ page?: string }>;
}

/**
 * The signed-in customer's own order history (B2C-ACCOUNTS). The list is whatever the API's ownership-scoped
 * `GET account/orders` returns for the verified session — the page sends no customer or order id of its own. A rejected
 * session sends the visitor back through the account sign-in; any other failure is an honest "try again".
 */
export default async function OrdersPage({
  params,
  searchParams,
}: OrdersPageProps) {
  const [{ country, locale }, query] = await Promise.all([
    params,
    searchParams,
  ]);
  const basePath = `/${country}/${locale}`;
  const page = Math.max(1, Number.parseInt(query.page ?? "1", 10) || 1);
  const result = await listOrders(page);

  if (result.kind !== "ok") {
    return (
      <OrdersUnavailable
        basePath={basePath}
        signedOut={result.kind === "signed_out"}
      />
    );
  }

  return (
    <AccountOrdersView
      orders={result.data.orders}
      basePath={basePath}
      page={result.data.page}
      lastPage={result.data.lastPage}
    />
  );
}
