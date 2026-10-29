"use server";

import { updateTag } from "next/cache";
import type { StoreCreditCard } from "@/lib/commerce/types";
import { getClient, withAuthRefresh } from "@/lib/spree";
import { actionResult, withFallback } from "./utils";

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

export async function deleteCreditCard(id: string) {
  return actionResult(async () => {
    await withAuthRefresh(async (options) => {
      return getClient().customer.creditCards.delete(id, options);
    });
    updateTag("credit-cards");
    return {};
  }, "Failed to delete credit card");
}
