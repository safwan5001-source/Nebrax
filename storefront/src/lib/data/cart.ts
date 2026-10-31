"use server";

import { updateTag } from "next/cache";
import {
  addAwjCartItem,
  fetchAwjCart,
  removeAwjCartItem,
  updateAwjCartItem,
} from "@/lib/commerce/cart";
import type { StorefrontCart } from "@/lib/commerce/cart-types";
import type { PdpSelections } from "@/lib/commerce/pdp-gifting";
import {
  type PurchaseIssue,
  purchaseIssueFromError,
} from "@/lib/commerce/wholesale-buyer";
import { actionResult } from "./utils";

/**
 * The AWJ cart actions (`getAwjCart`/`getAwjCartState`/`addAwjItem`/
 * `updateAwjItem`/`removeAwjItem`) are the storefront's only cart data
 * authority — see `CartContext`. The Spree-backed cart actions that used to sit
 * beside them served the removed Spree wholesale portal and are gone.
 */

function awjCartTag(): string {
  return "cart"; // The unsuffixed "cart" tag.
}

/** GET the AWJ cart. Never creates one (see `fetchAwjCart`). */
export async function getAwjCart(): Promise<StorefrontCart | null> {
  try {
    return await fetchAwjCart();
  } catch {
    return null;
  }
}

/**
 * H6 Batch K — the same read, plus WHY it came back empty when a wholesale refusal was the reason (signed out, membership not
 * approved / suspended). `purchaseIssue` is `undefined` for every other outcome, so a DTC visitor's result is exactly `getAwjCart()`'s.
 */
export async function getAwjCartState(): Promise<{
  cart: StorefrontCart | null;
  purchaseIssue?: PurchaseIssue;
}> {
  try {
    return { cart: await fetchAwjCart() };
  } catch (error) {
    const purchaseIssue = purchaseIssueFromError(error);
    return { cart: null, ...(purchaseIssue ? { purchaseIssue } : {}) };
  }
}

export async function addAwjItem(
  productId: string,
  quantity: number,
  unitKey = "base",
  variantId?: string | null,
  selections?: PdpSelections,
) {
  return actionResult(async () => {
    const cart = await addAwjCartItem(
      productId,
      quantity,
      unitKey,
      variantId,
      selections,
    );
    updateTag(awjCartTag());
    return { cart };
  }, "Failed to add item to cart");
}

export async function updateAwjItem(itemId: string, quantity: number) {
  return actionResult(async () => {
    const cart = await updateAwjCartItem(itemId, quantity);
    updateTag(awjCartTag());
    return { cart };
  }, "Failed to update cart item");
}

export async function removeAwjItem(itemId: string) {
  return actionResult(async () => {
    const cart = await removeAwjCartItem(itemId);
    updateTag(awjCartTag());
    return { cart };
  }, "Failed to remove cart item");
}
