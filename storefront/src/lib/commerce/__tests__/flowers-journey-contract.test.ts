import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { type AwjCart, lineGroups, mapAwjCartToViewModel } from "../cart-types";
import { mapDeliverySchedule } from "../checkout-gifting";
import {
  type AwjCheckout,
  type AwjOrder,
  mapAwjCheckoutToViewModel,
  mapAwjOrderToViewModel,
} from "../checkout-types";
import { parseListingFacets } from "../listing-facets";
import { parseProductGifting } from "../pdp-gifting";

/**
 * FLOWERS-H16 — the storefront's real parsers against the real backend's responses.
 *
 * `contracts/flowers-journey/*.json` is captured by `FlowersEndToEndJourneyTest` (PHP) from the actual `store/v1`
 * API during a full Flowers journey (taxonomy → content → personalization → add-ons → gift → schedule → cart →
 * checkout → order) and is compared against the live responses on every backend CI run. This test feeds the same
 * files through the storefront mappers, so a backend change that the storefront cannot read — or a storefront
 * parser that drifts from what the backend really sends — fails here instead of in a shopper's browser.
 *
 * Every other storefront test builds its input by hand; this is the only place the two sides meet.
 */
const DIR = resolve(process.cwd(), "../contracts/flowers-journey");
const load = (name: string) =>
  JSON.parse(readFileSync(resolve(DIR, `${name}.json`), "utf8")) as {
    data: any;
    meta: any;
  };

describe("Flowers journey — storefront parsers on real backend responses", () => {
  it("lists the occasion and recipient facets with counts on the listing meta", () => {
    const list = load("01-product-list");
    const facets = parseListingFacets(list.meta, "ar");
    expect(facets.groups.map((g) => g.key)).toEqual(["occasion", "recipient"]);
    const occasion = facets.groups[0];
    expect(occasion.systemKey).toBe("occasion");
    // Only values that have products in this listing are sent ("wedding" has none and is not listed).
    expect(occasion.values.map((v) => v.slug)).toEqual(["birthday"]);
    expect(occasion.values[0].count).toBe(1);
    expect(facets.groups[1].values.map((v) => v.slug)).toEqual(["for-her"]);
  });

  it("reads the PDP gifting blocks: personalization, content, add-ons and a same-day promise", () => {
    const product = load("02-product-detail").data;
    const gifting = parseProductGifting(product, "ar");

    expect(
      gifting.personalization.map((f) => [f.key, f.required, f.type]),
    ).toEqual([
      ["card-name", true, "text"],
      ["wrap", false, "select"],
    ]);
    expect(gifting.personalization[1].options.map((o) => o.valueKey)).toEqual([
      "kraft",
      "satin",
    ]);
    expect(gifting.contentBlocks.map((b) => b.type)).toEqual([
      "care",
      "included_items",
    ]);
    expect(gifting.addons.map((a) => [a.maxQuantity, a.amountMinor])).toEqual([
      [3, 7000],
      [1, 1500],
    ]);
    expect(gifting.deliveryPromise).toMatchObject({
      deliverable: true,
      sameDay: true,
    });
    expect(gifting.deliveryPromise?.earliest).toEqual({
      date: "2026-10-07",
      startTime: "16:00",
      endTime: "20:00",
    });

    // English locale picks the *_en label with an Arabic fallback.
    const en = parseProductGifting(product, "en");
    expect(en.personalization[0].label).toBe("Name on the card");
    expect(en.personalization[1].options.map((o) => o.label)).toEqual([
      "Kraft",
      "Satin",
    ]);
    expect(en.addons[0].name).toBe("علبة شوكولاتة"); // no name_en stored → falls back, never blank
  });

  it("reads the delivery schedule options the checkout offers", () => {
    for (const name of [
      "03-delivery-schedule",
      "07-delivery-schedule-for-city",
    ]) {
      const schedule = mapDeliverySchedule(load(name).data, "delivery");
      expect(schedule.enabled).toBe(true);
      expect(schedule.required).toBe(false);
      expect(schedule.timezone).toBe("Asia/Riyadh");
      expect(schedule.dates).toHaveLength(31);
      // Today's 16:00 window is still ahead of 10:00 Riyadh; both windows are offered on later days.
      expect(schedule.dates[0].slots.length).toBeGreaterThan(0);
      expect(schedule.dates[1].slots.map((s) => s.label)).toEqual([
        "مساءً",
        "ليلاً",
      ]);
    }
  });

  it("maps the cart: personalization answers on the parent line and the add-on grouped beneath it", () => {
    const cart = mapAwjCartToViewModel(load("05-cart").data as AwjCart);
    expect(cart.items).toHaveLength(2);
    const [parent, addon] = cart.items;
    expect(parent.personalization.map((p) => [p.key, p.display])).toEqual([
      ["card-name", "ريم"],
      ["wrap", "ساتان"],
    ]);
    expect(parent.addonOf).toBeNull();
    expect(addon.addonOf).toBe(parent.id);
    expect(addon.quantity).toBe(2);
    expect(addon.perParentQuantity).toBe(2);
    // The server prices every line; nothing is re-derived.
    expect(parent.lineTotal.amount_minor).toBe(24000);
    expect(addon.lineTotal.amount_minor).toBe(14000);
    expect(cart.subtotal.amount_minor).toBe(38000);
    expect(
      lineGroups(cart.items, { id: (l) => l.id, parent: (l) => l.addonOf }).map(
        (g) => g.addons.length,
      ),
    ).toEqual([1]);
  });

  it("maps the checkout: stored schedule, gift and the channel's gift options", () => {
    const checkout = mapAwjCheckoutToViewModel(
      load("10-checkout").data as AwjCheckout,
    );
    expect(checkout.schedule).toMatchObject({
      date: "2026-10-08",
      valid: true,
    });
    expect(checkout.schedule?.slot).toMatchObject({
      label: "مساءً",
      labelEn: "Evening",
      startTime: "16:00",
      endTime: "20:00",
    });
    expect(checkout.gift).toMatchObject({
      recipientName: "ريم الحربي",
      recipientPhone: "0555550101",
      senderDisplayName: "سالم",
      hideSender: false,
    });
    expect(checkout.gift?.message).toBe("كل عام وأنتِ بخير\nمع محبتي");
    expect(checkout.giftOptions).toMatchObject({ enabled: true });
    expect(checkout.giftOptions.messageMaxLength).toBeGreaterThan(0);
    expect(checkout.cart.items).toHaveLength(2);
  });

  it("maps the placed order with its immutable gift and schedule snapshots and the server total", () => {
    const order = mapAwjOrderToViewModel(
      load("11-order").data.order as AwjOrder,
    );
    expect(order.total.amount_minor).toBe(38000);
    expect(order.gift?.recipientName).toBe("ريم الحربي");
    expect(order.schedule).toMatchObject({
      date: "2026-10-08",
      method: "delivery",
      timezone: "Asia/Riyadh",
    });
    expect(order.schedule?.slot).toMatchObject({
      label: "مساءً",
      startTime: "16:00",
      endTime: "20:00",
    });
    expect(order.items).toHaveLength(2);
    expect(order.items[0].personalization.map((p) => p.display)).toEqual([
      "ريم",
      "ساتان",
    ]);
    expect(order.items[1].addonOf).toBe(order.items[0].lineId);
  });

  it("the fixtures stay free of anything that varies per run (ids are placeholder UUIDs, no tokens)", () => {
    const text = [
      "01-product-list",
      "02-product-detail",
      "10-checkout",
      "11-order",
    ]
      .map((n) => readFileSync(resolve(DIR, `${n}.json`), "utf8"))
      .join("\n");
    const ids =
      text.match(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      ) ?? [];
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every((id) => id.startsWith("00000000-0000-4000-8000-"))).toBe(
      true,
    );
    expect(text).not.toMatch(/awj_cart_token|Bearer /);
  });
});
