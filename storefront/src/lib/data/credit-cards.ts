"use server";

import type { StoreCreditCard } from "@/lib/commerce/types";
import { getClient, withAuthRefresh } from "@/lib/spree";
import { withFallback } from "./utils";

export async function getCreditCards(): Promise<{ data: StoreCreditCard[] }> {
  return withFallback(
    async () => {
      return withAuthRefresh(async (options) => {
        return getClient().customer.creditCards.list(undefined, options);
      });
    },
    { data: [] } as { data: StoreCreditCard[] },
  );
}
