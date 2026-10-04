import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AwjOffer } from "../types";

const mocks = vi.hoisted(() => ({
  headers: vi.fn(async () => new Headers({ host: "shop.example.com" })),
  getLocale: vi.fn(async () => "ar"),
}));

vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("next-intl/server", () => ({ getLocale: mocks.getLocale }));

const { StorefrontApiError } = await import("../config");
const { fetchOffers, mapAwjOffer } = await import("../offers");
const { formatMoney } = await import("../mappers");

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

function awjOffer(overrides: Partial<AwjOffer> = {}): AwjOffer {
  return {
    id: "o1",
    product_id: "p1",
    name: "هاتف",
    name_en: "Phone",
    thumbnail_url: null,
    reference_price: { amount_minor: 25000, currency: "SAR" },
    offer_price: { amount_minor: 19000, currency: "SAR" },
    discount_percent: 24,
    starts_at: null,
    ends_at: null,
    ...overrides,
  };
}

describe("commerce/offers — CUST-H4-7", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubEnv("AWJ_COMMERCE_API_URL", "https://api.awj.test");
    vi.stubEnv("STOREFRONT_GATEWAY_SECRET", "s3cret");
    vi.stubGlobal("fetch", fetchMock);
    mocks.getLocale.mockResolvedValue("ar");
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("reads the Host-resolved public route with no id, no query and the forwarded-host headers", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [], meta: {} }));
    await fetchOffers();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.awj.test/store/v1/offers");
    expect(new URL(url).search).toBe("");
    expect(init.headers["X-Storefront-Forwarded-Host"]).toBe(
      "shop.example.com",
    );
    expect(init.headers["X-Storefront-Gateway-Secret"]).toBe("s3cret");
    expect(init.method).toBeUndefined();
  });

  it("maps both prices and discount_percent verbatim — nothing is recomputed", async () => {
    // Deliberately inconsistent numbers: a client that re-derived the
    // percent from the prices would not print 61.
    fetchMock.mockResolvedValue(
      jsonResponse({ data: [awjOffer({ discount_percent: 61 })] }),
    );
    const [offer] = await fetchOffers();

    expect(offer).toMatchObject({
      id: "o1",
      productId: "p1",
      name: "هاتف",
      discountPercent: 61,
      referencePrice: { amountMinor: 25000, currency: "SAR" },
      offerPrice: { amountMinor: 19000, currency: "SAR" },
    });
    // Display strings come from the storefront's existing currency formatter.
    expect(offer.offerPrice.display).toBe(formatMoney(19000, "SAR"));
    expect(offer.referencePrice.display).toBe(formatMoney(25000, "SAR"));
    // No derived field exists on the view model.
    expect(Object.keys(offer).sort()).toEqual(
      [
        "discountPercent",
        "id",
        "name",
        "offerPrice",
        "productId",
        "referencePrice",
        "thumbnailUrl",
      ].sort(),
    );
  });

  it("keeps a 0% genuine discount as 0 (display decides the badge, the client never rounds up)", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ data: [awjOffer({ discount_percent: 0 })] }),
    );
    expect((await fetchOffers())[0].discountPercent).toBe(0);
  });

  it("uses the English product name under the English locale, falling back to the Arabic one", async () => {
    mocks.getLocale.mockResolvedValue("en");
    fetchMock.mockResolvedValue(
      jsonResponse({
        data: [
          awjOffer(),
          awjOffer({ id: "o2", name_en: null, name: "بدون إنجليزي" }),
        ],
      }),
    );
    const offers = await fetchOffers();
    expect(offers.map((o) => o.name)).toEqual(["Phone", "بدون إنجليزي"]);
  });

  it("routes an AWJ media URL through the same-origin proxy like every product image", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        data: [
          awjOffer({
            thumbnail_url: "https://api.awj.test/store/v1/media/m-1",
          }),
        ],
      }),
    );
    expect((await fetchOffers())[0].thumbnailUrl).toBe(
      "/api/storefront/media/m-1",
    );
  });

  it("returns the API's own order untouched (display order is the shelf's job, not the client's)", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        data: [
          awjOffer({ id: "z" }),
          awjOffer({ id: "a" }),
          awjOffer({ id: "m" }),
        ],
      }),
    );
    expect((await fetchOffers()).map((o) => o.id)).toEqual(["z", "a", "m"]);
  });

  it.each([
    ["no id", { id: "" }],
    ["no product", { product_id: "" }],
    ["blank name", { name: "  " }],
    ["no reference price", { reference_price: null }],
    ["no offer price", { offer_price: null }],
    [
      "a non-numeric amount",
      { offer_price: { amount_minor: "19000", currency: "SAR" } },
    ],
    ["no currency", { reference_price: { amount_minor: 25000, currency: "" } }],
    ["a non-numeric percent", { discount_percent: "24" }],
  ])("drops a row with %s instead of patching it up", async (_label, patch) => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        data: [{ ...awjOffer(), ...patch }, awjOffer({ id: "good" })],
      }),
    );
    expect((await fetchOffers()).map((o) => o.id)).toEqual(["good"]);
  });

  it("returns [] for a malformed envelope and for an empty list", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));
    expect(await fetchOffers()).toEqual([]);
    fetchMock.mockResolvedValue(jsonResponse({ data: "nope" }));
    expect(await fetchOffers()).toEqual([]);
    fetchMock.mockResolvedValue(jsonResponse({ data: [] }));
    expect(await fetchOffers()).toEqual([]);
  });

  it("surfaces an HTTP failure as a StorefrontApiError (the shelf decides to omit)", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: "not_found", message: "no" } }, false, 404),
    );
    await expect(fetchOffers()).rejects.toBeInstanceOf(StorefrontApiError);
  });

  it("mapAwjOffer rejects non-objects", () => {
    for (const raw of [null, undefined, "x", 3, []]) {
      expect(mapAwjOffer(raw)).toBeNull();
    }
  });
});
