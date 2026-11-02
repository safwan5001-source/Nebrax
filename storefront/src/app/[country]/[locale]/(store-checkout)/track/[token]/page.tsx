"use client";

import { useParams, usePathname } from "next/navigation";
import { OrderTrackingView } from "@/components/orders/OrderTrackingView";
import { extractBasePath } from "@/lib/utils/path";

/**
 * COPS-H2-5 (D-H2-15) — `/{country}/{locale}/track/{token}`. The token is read from the path only; the page asks the server
 * (`GET store/v1/order-tracking/{token}`) and believes nothing else. Same minimal chrome as the payment-return page.
 */
export default function AwjOrderTrackingPage() {
  const params = useParams<{ token: string }>();
  const basePath = extractBasePath(usePathname());
  const token = typeof params?.token === "string" ? params.token : "";
  return <OrderTrackingView token={token} basePath={basePath} />;
}
