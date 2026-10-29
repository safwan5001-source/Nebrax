"use server";

import type { StoreGiftCard } from "@/lib/commerce/types";
import { getClient, withAuthRefresh } from "@/lib/spree";
import { withFallback } from "./utils";

export async function getGiftCards() {
  return withFallback(
    async () => {
      return withAuthRefresh(async (options) => {
        return getClient().customer.giftCards.list(undefined, options);
      });
    },
    { data: [] } as { data: StoreGiftCard[] },
  );
}

export async function getGiftCard(id: string) {
  return withFallback(async () => {
    return withAuthRefresh(async (options) => {
      return getClient().customer.giftCards.get(id, options);
    });
  }, null);
}
