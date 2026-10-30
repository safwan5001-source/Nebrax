"use server";

import {
  DEFAULT_SURFACE,
  getCartOptions,
  getClientForSurface,
  type Surface,
} from "@/lib/spree";
import { withFallback } from "./utils";

/**
 * Get a single order by ID or number.
 * Works for both authenticated users (JWT) and guests (spreeToken).
 * The surface selects the cart token cookie + client so wholesale orders
 * resolve through the wholesale channel.
 */
export async function getOrder(
  id: string,
  params?: Record<string, unknown>,
  surface: Surface = DEFAULT_SURFACE,
) {
  return withFallback(async () => {
    const options = await getCartOptions(surface);
    return getClientForSurface(surface).orders.get(id, params, options);
  }, null);
}
