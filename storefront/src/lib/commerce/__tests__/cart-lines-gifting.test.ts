import { describe, expect, it } from "vitest";
import {
  type AwjCart,
  groupAddonLines,
  lineGroups,
  mapAwjCartToViewModel,
  mapLinePersonalization,
} from "../cart-types";
import { type AwjOrder, mapAwjOrderToViewModel } from "../checkout-types";

const money = (amount_minor: number) => ({ amount_minor, currency: "SAR" });

function line(
  id: string,
  over: Record<string, unknown> = {},
): AwjCart["items"][number] {
  return {
    id,
    product_id: `prod-${id}`,
    product_variant_id: null,
    variant_descriptor: null,
    product_name: `Product ${id}`,
    unit_key: "base",
    unit_name: "piece",
    quantity: 1,
    unit_price: money(1000),
    line_total: money(1000),
    available: true,
    ...over,
  };
}

function cart(items: AwjCart["items"]): AwjCart {
  return {
    status: "active",
    items,
    subtotal: money(0),
    currency: "SAR",
    has_unavailable_items: false,
  };
}

describe("cart line personalization and add-ons (FLOWERS-H12a)", () => {
  it("maps personalization answers, preferring the option label for a choice", () => {
    expect(
      mapLinePersonalization([
        {
          key: "card",
          label: "نص",
          label_en: "Card",
          value: "Happy",
          value_label: null,
        },
        {
          key: "vase",
          label: "اللون",
          label_en: null,
          value: "white",
          value_label: "أبيض",
        },
        {
          key: "blank",
          label: "x",
          label_en: null,
          value: "  ",
          value_label: null,
        },
      ]),
    ).toEqual([
      { key: "card", label: "نص", labelEn: "Card", display: "Happy" },
      { key: "vase", label: "اللون", labelEn: null, display: "أبيض" },
    ]);
  });

  it("drops malformed personalization rows and tolerates absence", () => {
    expect(mapLinePersonalization(undefined)).toEqual([]);
    expect(
      mapLinePersonalization([
        null as never,
        { key: 1, label: "x", value: "y" } as never,
        { key: "k", label: "x" } as never,
      ]),
    ).toEqual([]);
  });

  it("an ordinary line carries empty personalization and no add-on link", () => {
    const [row] = mapAwjCartToViewModel(cart([line("a")])).items;
    expect(row.personalization).toEqual([]);
    expect(row.addonOf).toBeNull();
    expect(row.perParentQuantity).toBeNull();
  });

  it("maps an add-on line's parent link and per-parent quantity", () => {
    const view = mapAwjCartToViewModel(
      cart([
        line("a"),
        line("b", { addon_of: "a", per_parent_quantity: 2, quantity: 4 }),
      ]),
    );
    expect(view.items[1]).toMatchObject({
      addonOf: "a",
      perParentQuantity: 2,
      quantity: 4,
    });
  });

  it("puts each add-on directly under its own parent even when the API interleaves them", () => {
    const view = mapAwjCartToViewModel(
      cart([
        line("bouquet-1"),
        line("bouquet-2"),
        line("choc-for-2", { addon_of: "bouquet-2", per_parent_quantity: 1 }),
        line("card-for-1", { addon_of: "bouquet-1", per_parent_quantity: 1 }),
        line("choc-for-1", { addon_of: "bouquet-1", per_parent_quantity: 1 }),
      ]),
    );
    expect(view.items.map((i) => i.id)).toEqual([
      "bouquet-1",
      "card-for-1",
      "choc-for-1",
      "bouquet-2",
      "choc-for-2",
    ]);
  });

  it("keeps an orphaned add-on (parent gone) instead of dropping it", () => {
    const view = mapAwjCartToViewModel(
      cart([
        line("a"),
        line("orphan", { addon_of: "missing", per_parent_quantity: 1 }),
      ]),
    );
    expect(view.items.map((i) => i.id)).toEqual(["a", "orphan"]);
  });

  it("counts only the lines the shopper added, not their add-ons", () => {
    const view = mapAwjCartToViewModel(
      cart([
        line("a", { quantity: 2 }),
        line("b", { addon_of: "a", per_parent_quantity: 1, quantity: 2 }),
        line("c", { quantity: 1 }),
      ]),
    );
    expect(view.itemCount).toBe(3);
  });

  it("groupAddonLines leaves a list without add-ons untouched", () => {
    const rows = [
      { id: "x", p: null },
      { id: "y", p: null },
    ];
    expect(
      groupAddonLines(rows, { id: (r) => r.id, parent: (r) => r.p }),
    ).toEqual(rows);
  });
});

describe("order line personalization and add-ons (FLOWERS-H12a)", () => {
  const order = (items: AwjOrder["items"]): AwjOrder => ({
    id: "o1",
    number: "ORD-1",
    status: "confirmed",
    delivery_method: "standard",
    total: money(0),
    contact: { name: null, phone: null, email: null },
    delivery: {
      country: null,
      city: null,
      district: null,
      street: null,
      postal_code: null,
      notes: null,
    },
    payment: { method: null, status: null, payment_method_name: null },
    items,
    created_at: null,
  });
  const item = (over: Record<string, unknown>): AwjOrder["items"][number] => ({
    product_id: "p",
    product_name: "n",
    unit_name: null,
    quantity: 1,
    unit_price: money(1),
    line_total: money(1),
    ...over,
  });

  it("maps personalization, line ids and add-on links, grouping add-ons under their parent", () => {
    const view = mapAwjOrderToViewModel(
      order([
        item({ product_name: "Bouquet A", line_id: "la" }),
        item({
          product_name: "Bouquet B",
          line_id: "lb",
          personalization: [
            {
              key: "k",
              label: "Card",
              label_en: null,
              value: "Hi",
              value_label: null,
            },
          ],
        }),
        item({
          product_name: "Chocolate for A",
          line_id: "lc",
          addon_of: "la",
        }),
      ]),
    );
    expect(view.items.map((i) => i.productName)).toEqual([
      "Bouquet A",
      "Chocolate for A",
      "Bouquet B",
    ]);
    expect(view.items[1].addonOf).toBe("la");
    expect(view.items[2].personalization).toEqual([
      { key: "k", label: "Card", labelEn: null, display: "Hi" },
    ]);
  });

  it("an ordinary order is unchanged in shape", () => {
    const [row] = mapAwjOrderToViewModel(order([item({})])).items;
    expect(row).toMatchObject({
      personalization: [],
      lineId: null,
      addonOf: null,
    });
  });
});

describe("lineGroups (FLOWERS-H12a)", () => {
  const ids = {
    id: (r: { id: string; p: string | null }) => r.id,
    parent: (r: { id: string; p: string | null }) => r.p,
  };

  it("groups each add-on under its parent and keeps ordinary lines as their own group", () => {
    const rows = [
      { id: "a", p: null },
      { id: "a1", p: "a" },
      { id: "a2", p: "a" },
      { id: "b", p: null },
    ];
    expect(
      lineGroups(rows, ids).map((g) => [g.line.id, g.addons.map((x) => x.id)]),
    ).toEqual([
      ["a", ["a1", "a2"]],
      ["b", []],
    ]);
  });

  it("gives an orphaned add-on a group of its own instead of attaching it to a neighbour", () => {
    const rows = [
      { id: "a", p: null },
      { id: "o", p: "gone" },
    ];
    expect(
      lineGroups(rows, ids).map((g) => [g.line.id, g.addons.length]),
    ).toEqual([
      ["a", 0],
      ["o", 0],
    ]);
  });
});
