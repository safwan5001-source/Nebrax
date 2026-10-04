import { describe, expect, it } from "vitest";
import {
  MAX_ADDONS,
  MAX_PERSONALIZATION_FIELDS,
  missingRequiredFields,
  parseProductGifting,
} from "../pdp-gifting";

const UUID_A = "0a1b2c3d-1111-4222-8333-444455556666";
const UUID_B = "1a1b2c3d-1111-4222-8333-444455556666";

const field = (over: Record<string, unknown> = {}) => ({
  key: "card_text",
  type: "text",
  label: "نص البطاقة",
  label_en: "Card text",
  help_text: null,
  is_required: true,
  max_length: 60,
  options: [],
  ...over,
});

const addon = (over: Record<string, unknown> = {}) => ({
  product_id: UUID_A,
  product_variant_id: null,
  name: "شوكولاتة",
  name_en: "Chocolates",
  price: { amount_minor: 4500, currency: "SAR" },
  in_stock: true,
  max_quantity: 3,
  thumbnail_url: null,
  ...over,
});

describe("parseProductGifting (FLOWERS-H11)", () => {
  it("is empty for a product without gifting blocks", () => {
    expect(parseProductGifting({}, "ar")).toEqual({
      personalization: [],
      contentBlocks: [],
      addons: [],
      deliveryPromise: null,
    });
  });

  it("parses and localizes personalization fields", () => {
    const raw = {
      personalization: {
        fields: [
          field(),
          field({
            key: "vase",
            type: "select",
            label: "اللون",
            label_en: "Colour",
            is_required: false,
            max_length: null,
            options: [
              { value_key: "white", label: "أبيض", label_en: "White" },
              { value_key: "", label: "bad" },
            ],
          }),
        ],
      },
    };
    const en = parseProductGifting(raw, "en").personalization;
    expect(
      en.map((f) => [f.key, f.label, f.type, f.required, f.maxLength]),
    ).toEqual([
      ["card_text", "Card text", "text", true, 60],
      ["vase", "Colour", "select", false, null],
    ]);
    expect(en[1].options).toEqual([{ valueKey: "white", label: "White" }]);
    expect(parseProductGifting(raw, "ar").personalization[0].label).toBe(
      "نص البطاقة",
    );
  });

  it("drops invalid, duplicate and unanswerable fields, and bounds the count", () => {
    const raw = {
      personalization: {
        fields: [
          field({ key: "BAD KEY" }),
          field({ type: "weird" }),
          field({ label: " ", label_en: null }),
          field({ key: "sel", type: "select", options: [] }),
          field({ key: "ok" }),
          field({ key: "ok" }),
          "junk",
          ...Array.from({ length: 12 }, (_, i) => field({ key: `k${i}` })),
        ],
      },
    };
    const parsed = parseProductGifting(raw, "en").personalization;
    expect(parsed[0].key).toBe("ok");
    expect(new Set(parsed.map((f) => f.key)).size).toBe(parsed.length);
    expect(parsed.length).toBeLessThanOrEqual(MAX_PERSONALIZATION_FIELDS);
    expect(parsed.some((f) => f.key === "sel")).toBe(false);
  });

  it("parses content blocks as plain text and drops unknown types or empty bodies", () => {
    const raw = {
      content_blocks: [
        { type: "care", body: "Keep cool", body_en: null },
        { type: "allergens", body: "عام", body_en: "Contains nuts" },
        { type: "marketing", body: "x" },
        { type: "storage", body: "  " },
        { type: "composition" },
      ],
    };
    expect(parseProductGifting(raw, "en").contentBlocks).toEqual([
      { type: "care", body: "Keep cool" },
      { type: "allergens", body: "Contains nuts" },
    ]);
  });

  it("parses add-ons and rejects anything the cart could not accept", () => {
    const raw = {
      addons: [
        addon(),
        addon({ product_id: "nope" }),
        addon({ product_variant_id: "nope" }),
        addon({ price: { amount_minor: -1, currency: "SAR" } }),
        addon({ price: { amount_minor: 10.5, currency: "SAR" } }),
        addon({ price: { amount_minor: 10, currency: "sar" } }),
        addon({ max_quantity: 0 }),
        addon({ max_quantity: 11 }),
        addon({ name: "", name_en: null }),
        addon({ product_variant_id: UUID_B, in_stock: false }),
      ],
    };
    const parsed = parseProductGifting(raw, "en").addons;
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({
      productId: UUID_A,
      variantId: null,
      name: "Chocolates",
      amountMinor: 4500,
      currency: "SAR",
      maxQuantity: 3,
      inStock: true,
    });
    expect(parsed[1]).toMatchObject({ variantId: UUID_B, inStock: false });
    const many = Array.from({ length: 20 }, (_, i) =>
      addon({
        product_variant_id: null,
        product_id: `${i.toString(16).padStart(8, "0")}-1111-4222-8333-444455556666`,
      }),
    );
    expect(parseProductGifting({ addons: many }, "en").addons).toHaveLength(
      MAX_ADDONS,
    );
  });

  describe("delivery promise", () => {
    const slot = {
      id: UUID_A,
      label: "x",
      label_en: null,
      start_time: "19:00",
      end_time: "22:00",
    };

    it("reads a deliverable promise and keeps the server's same-day flag", () => {
      const parsed = parseProductGifting(
        {
          delivery_promise: {
            deliverable: true,
            same_day: true,
            earliest: { date: "2026-10-05", slot },
            reason: null,
          },
        },
        "en",
      ).deliveryPromise;
      expect(parsed).toEqual({
        deliverable: true,
        sameDay: true,
        earliest: { date: "2026-10-05", startTime: "19:00", endTime: "22:00" },
      });
    });

    it("reads a not-deliverable promise without an earliest slot (and never same-day)", () => {
      expect(
        parseProductGifting(
          {
            delivery_promise: {
              deliverable: false,
              same_day: true,
              earliest: null,
              reason: "out_of_stock",
            },
          },
          "en",
        ).deliveryPromise,
      ).toEqual({ deliverable: false, sameDay: false, earliest: null });
    });

    it("states no promise when the payload is absent or a deliverable promise is malformed", () => {
      expect(parseProductGifting({}, "en").deliveryPromise).toBeNull();
      expect(
        parseProductGifting({ delivery_promise: "x" }, "en").deliveryPromise,
      ).toBeNull();
      expect(
        parseProductGifting(
          {
            delivery_promise: {
              deliverable: true,
              same_day: false,
              earliest: { date: "tomorrow", slot },
              reason: null,
            },
          },
          "en",
        ).deliveryPromise,
      ).toBeNull();
      expect(
        parseProductGifting(
          {
            delivery_promise: {
              deliverable: true,
              same_day: false,
              earliest: {
                date: "2026-10-05",
                slot: { ...slot, start_time: "7pm" },
              },
              reason: null,
            },
          },
          "en",
        ).deliveryPromise,
      ).toBeNull();
    });
  });
});

describe("missingRequiredFields", () => {
  const fields = parseProductGifting(
    {
      personalization: {
        fields: [
          field({ key: "a" }),
          field({ key: "b", is_required: false }),
          field({ key: "c" }),
        ],
      },
    },
    "en",
  ).personalization;

  it("lists required fields that are blank or whitespace-only", () => {
    expect(missingRequiredFields(fields, { a: "  ", b: "", c: "x" })).toEqual([
      "a",
    ]);
    expect(missingRequiredFields(fields, {})).toEqual(["a", "c"]);
    expect(missingRequiredFields(fields, { a: "x", c: "y" })).toEqual([]);
  });
});
