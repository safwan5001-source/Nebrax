import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  headers: vi.fn(async () => new Headers({ host: "shop.example.com" })),
}));

vi.mock("next/headers", () => ({ headers: mocks.headers }));

const { fetchStorefrontConfig } = await import("../storefront");

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

const base = {
  name: "متجر",
  default_locale: "ar",
  business_identity: { legal_name: null, cr_number: null, vat_number: null },
};

describe("fetchStorefrontConfig — data.ordering (COPS-H4 Buyer Ordering UX)", () => {
  beforeEach(() => {
    vi.stubEnv("AWJ_COMMERCE_API_URL", "http://awj-api.test");
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("reads the existing ordering block from GET store/v1/storefront — no other endpoint is called", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        data: {
          ...base,
          ordering: {
            accepting: false,
            reason: "paused",
            message: "نعود قريباً",
            resumes_at: "2026-11-09T14:00:00+00:00",
            min_order_minor: 15000,
            min_order_scope: "delivery_only",
          },
        },
      }),
    );

    const config = await fetchStorefrontConfig();

    expect(config.ordering).toEqual({
      accepting: false,
      reason: "paused",
      message: "نعود قريباً",
      resumesAt: "2026-11-09T14:00:00+00:00",
      minOrderMinor: 15000,
      minOrderScope: "delivery_only",
    });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toBe(
      "http://awj-api.test/store/v1/storefront",
    );
  });

  // Gate closed ⇒ the backend omits the key entirely and the response is the pre-H4 one: nothing may change for the buyer.
  it("with the gate closed (no ordering key) yields ordering null and leaves every other field as before", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ data: base }));

    const config = await fetchStorefrontConfig();

    expect(config.ordering).toBeNull();
    expect(config.name).toBe("متجر");
    expect(config.default_locale).toBe("ar");
    expect(config.presentation).toBeNull();
    expect(config.capabilities).toEqual({
      wholesaleBuyer: false,
      customerAccounts: false,
    });
  });

  it("treats a malformed ordering block as absent rather than guessing", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ data: { ...base, ordering: { accepting: "no" } } }),
    );

    expect((await fetchStorefrontConfig()).ordering).toBeNull();
  });
});
