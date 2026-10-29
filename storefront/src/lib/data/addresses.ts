"use server";

import { updateTag } from "next/cache";
import type { StoreAddress, StoreAddressParams } from "@/lib/commerce/types";
import { getClient, withAuthRefresh } from "@/lib/spree";
import { actionResult, withFallback } from "./utils";

export async function getAddresses() {
  return withFallback(
    async () => {
      return withAuthRefresh(async (options) => {
        return getClient().customer.addresses.list(undefined, options);
      });
    },
    { data: [] } as { data: StoreAddress[] },
  );
}

export async function updateAddress(
  id: string,
  address: Partial<StoreAddressParams>,
) {
  return actionResult(async () => {
    const result = await withAuthRefresh(async (options) => {
      return getClient().customer.addresses.update(id, address, options);
    });
    updateTag("addresses");
    return { address: result };
  }, "Failed to update address");
}
