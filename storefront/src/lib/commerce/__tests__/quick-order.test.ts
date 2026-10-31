import { describe, expect, it } from "vitest";
import {
  eligibleEntries,
  failuresFromError,
  mergeEntry,
  normalizeDigits,
  parsePastedRows,
  QUICK_ORDER_MAX_LINES,
  QUICK_ORDER_MAX_QUANTITY,
  type QuickOrderEntry,
  type QuickOrderLine,
  quantityError,
  quantityValue,
  quickOrderLineFromApi,
  submitItems,
} from "../quick-order";

const P1 = "11111111-1111-4111-8111-111111111111";
const V1 = "22222222-2222-4222-8222-222222222222";

const line = (over: Partial<QuickOrderLine> = {}): QuickOrderLine => ({
  productId: P1,
  variantId: null,
  unitKey: "base",
  unitName: "piece",
  sku: "COF-100",
  name: "قهوة",
  nameEn: "Coffee",
  descriptor: null,
  price: { amountMinor: 700, currency: "SAR" },
  available: true,
  unavailableReason: null,
  inStock: null,
  exact: true,
  ...over,
});
const entry = (id: string, quantity: string, l = line()): QuickOrderEntry => ({
  id,
  line: l,
  quantity,
});

describe("quickOrderLineFromApi", () => {
  const raw = {
    product_id: P1,
    product_variant_id: V1,
    unit_key: "base",
    unit_name: "piece",
    sku: "SHIRT-RED",
    name: "قميص",
    name_en: "Shirt",
    descriptor: "Red",
    price: { amount_minor: 2500, currency: "SAR" },
    available: true,
    unavailable_reason: null,
    in_stock: true,
    exact: true,
  };

  it("maps a well-formed line", () => {
    expect(quickOrderLineFromApi(raw)).toMatchObject({
      productId: P1,
      variantId: V1,
      sku: "SHIRT-RED",
      price: { amountMinor: 2500, currency: "SAR" },
      available: true,
      exact: true,
    });
  });

  it("an 'available' line without a price is unavailable, never priced by guesswork", () => {
    const l = quickOrderLineFromApi({ ...raw, price: null });
    expect(l).toMatchObject({ available: false, price: null });
    expect(l?.unavailableReason).toBe("not_purchasable");
  });

  it("carries the wholesale reason and never a price for an unpriced line", () => {
    const l = quickOrderLineFromApi({
      ...raw,
      available: false,
      price: { amount_minor: 9999, currency: "SAR" },
      unavailable_reason: "no_wholesale_price",
    });
    expect(l).toMatchObject({
      available: false,
      price: null,
      unavailableReason: "no_wholesale_price",
    });
  });

  it("drops anything malformed", () => {
    for (const bad of [
      null,
      "x",
      [],
      { ...raw, product_id: "nope" },
      { ...raw, product_variant_id: "nope" },
      { ...raw, name: "" },
      { ...raw, product_id: undefined },
    ]) {
      expect(quickOrderLineFromApi(bad)).toBeNull();
    }
  });
});

describe("quantities", () => {
  it("accepts whole numbers 1..max, in Latin or Arabic-Indic digits", () => {
    expect(quantityError("1")).toBeNull();
    expect(quantityError(" 12 ")).toBeNull();
    expect(quantityError("١٢")).toBeNull();
    expect(quantityValue("١٢")).toBe(12);
    expect(quantityError(String(QUICK_ORDER_MAX_QUANTITY))).toBeNull();
  });

  it("rejects everything else and never rounds or clamps", () => {
    expect(quantityError("")).toBe("required");
    expect(quantityError("   ")).toBe("required");
    for (const bad of [
      "0",
      "-1",
      "1.5",
      "1,5",
      "abc",
      "1e3",
      "٠",
      "+2",
      "２",
    ]) {
      expect(quantityError(bad), bad).toBe("invalid");
    }
    expect(quantityError(String(QUICK_ORDER_MAX_QUANTITY + 1))).toBe(
      "too_large",
    );
  });

  it("normalizes Persian numerals too", () => {
    expect(normalizeDigits("۱۲۳")).toBe("123");
  });
});

describe("parsePastedRows", () => {
  it("reads SKU + quantity separated by space, comma, semicolon, tab or ×", () => {
    const { rows } = parsePastedRows(
      "ABC-100 12\nSHIRT-RED, 4\nX-1;7\nT-9\t3\nCOF-100 × 5\nBOX x 2",
    );
    expect(rows).toEqual([
      { sku: "ABC-100", quantity: "12" },
      { sku: "SHIRT-RED", quantity: "4" },
      { sku: "X-1", quantity: "7" },
      { sku: "T-9", quantity: "3" },
      { sku: "COF-100", quantity: "5" },
      { sku: "BOX", quantity: "2" },
    ]);
  });

  it("a lone SKU means quantity 1, and a latin x glued to a SKU is part of the SKU", () => {
    expect(parsePastedRows("ABC-100\nSHIRTX5\nABC-1x5").rows).toEqual([
      { sku: "ABC-100", quantity: "1" },
      { sku: "SHIRTX5", quantity: "1" },
      { sku: "ABC-1x5", quantity: "1" },
    ]);
  });

  it("converts Arabic-Indic quantities and ignores blank lines and CRLF", () => {
    expect(parsePastedRows("A-1 ٣\r\n\r\n  \r\nB-2 ٤٠\r\n").rows).toEqual([
      { sku: "A-1", quantity: "3" },
      { sku: "B-2", quantity: "40" },
    ]);
  });

  it("a SKU containing spaces keeps them (only the last numeric token is the quantity)", () => {
    expect(parsePastedRows("RED SHIRT L 6").rows).toEqual([
      { sku: "RED SHIRT L", quantity: "6" },
    ]);
  });

  it("caps the number of rows and says so", () => {
    const text = Array.from({ length: 60 }, (_, i) => `S-${i} 1`).join("\n");
    const { rows, truncated } = parsePastedRows(text);
    expect(rows).toHaveLength(QUICK_ORDER_MAX_LINES);
    expect(truncated).toBe(true);
    expect(parsePastedRows("A 1\nB 2").truncated).toBe(false);
  });

  it("a non-integer last token is not a quantity", () => {
    expect(parsePastedRows("ABC two").rows).toEqual([
      { sku: "ABC two", quantity: "1" },
    ]);
  });
});

describe("entries", () => {
  it("only available lines with a valid quantity are eligible", () => {
    const entries = [
      entry("a", "2"),
      entry("b", "0"),
      entry("c", "3", line({ available: false, price: null })),
      entry("d", "x"),
    ];
    expect(eligibleEntries(entries).map((e) => e.id)).toEqual(["a"]);
  });

  it("the wire shape carries ids, unit and quantity only — never a price or an identity", () => {
    const items = submitItems([
      entry("a", " ٣ "),
      entry("b", "2", line({ variantId: V1, sku: "SHIRT-RED" })),
    ]);
    expect(items).toEqual([
      { product_id: P1, unit_key: "base", quantity: 3 },
      { product_id: P1, product_variant_id: V1, unit_key: "base", quantity: 2 },
    ]);
    const blob = JSON.stringify(items);
    for (const forbidden of [
      "price",
      "amount",
      "partner",
      "tenant",
      "channel",
      "buyer",
      "total",
    ]) {
      expect(blob).not.toContain(forbidden);
    }
  });

  it("merging the same product/variant/unit sums the quantities; different variants stay apart", () => {
    const merged = mergeEntry([entry("a", "2")], entry("b", "3"));
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ id: "a", quantity: "5" });

    const apart = mergeEntry(
      [entry("a", "2")],
      entry("b", "3", line({ variantId: V1 })),
    );
    expect(apart).toHaveLength(2);
  });

  it("merging never exceeds the ceiling", () => {
    const merged = mergeEntry(
      [entry("a", String(QUICK_ORDER_MAX_QUANTITY))],
      entry("b", "5"),
    );
    expect(merged[0].quantity).toBe(String(QUICK_ORDER_MAX_QUANTITY));
  });
});

describe("failuresFromError", () => {
  it("reads the server's per-line rejection", () => {
    expect(
      failuresFromError({
        status: 422,
        details: {
          reason: "quick_order_rejected",
          lines: [
            { index: 1, reason: "unavailable_for_wholesale" },
            { index: "x", reason: "bad" },
            { index: 2 },
          ],
        },
      }),
    ).toEqual([{ index: 1, reason: "unavailable_for_wholesale" }]);
  });

  it("is null for any other error", () => {
    expect(failuresFromError(new Error("x"))).toBeNull();
    expect(failuresFromError({ details: { reason: "other" } })).toBeNull();
    expect(failuresFromError(null)).toBeNull();
  });
});
