/**
 * H6 Batch D — characterization of the legacy wholesale boundary.
 *
 * These tests pin what the legacy (Spree-shaped, env-gated) wholesale portal
 * does TODAY so a native AWJ replacement cannot silently change a price,
 * authorization or tenant boundary. They are not a statement that this
 * behaviour is the target: see docs/audits/AWJ_H6_BATCH_D_NATIVE_WHOLESALE_REPORT.md.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFetchProducts = vi.fn();
const mockFetchProduct = vi.fn();
const mockFetchProductFilters = vi.fn();
const mockGetWholesaleClient = vi.fn();
const mockIsWholesaleEnabled = vi.fn();

vi.mock("@/lib/commerce/products", () => ({
  fetchProducts: (...a: unknown[]) => mockFetchProducts(...a),
  fetchProduct: (...a: unknown[]) => mockFetchProduct(...a),
  fetchProductFilters: (...a: unknown[]) => mockFetchProductFilters(...a),
}));

vi.mock("@/lib/spree", () => ({
  getAccessToken: vi.fn(),
  getWholesaleClient: (...a: unknown[]) => mockGetWholesaleClient(...a),
  isWholesaleEnabled: () => mockIsWholesaleEnabled(),
  withAuthRefresh: vi.fn(),
}));

import {
  getWholesaleChannel,
  getWholesaleProduct,
  getWholesaleProductFilters,
  getWholesaleProducts,
} from "@/lib/data/wholesale";

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchProducts.mockResolvedValue({ data: [] });
  mockFetchProduct.mockResolvedValue({ id: "p1" });
  mockFetchProductFilters.mockResolvedValue({ filters: [] });
});

describe("getWholesaleChannel", () => {
  it("returns null and never builds a Spree client while wholesale is off", async () => {
    mockIsWholesaleEnabled.mockReturnValue(false);

    await expect(getWholesaleChannel()).resolves.toBeNull();
    expect(mockGetWholesaleClient).not.toHaveBeenCalled();
  });

  it("degrades to null (sign-in wall) when the channel lookup fails — no other channel is substituted", async () => {
    mockIsWholesaleEnabled.mockReturnValue(true);
    mockGetWholesaleClient.mockReturnValue({
      channel: { get: vi.fn().mockRejectedValue(new Error("unreachable")) },
    });

    await expect(getWholesaleChannel()).resolves.toBeNull();
  });
});

describe("wholesale catalogue fetchers (price boundary — NOT native yet)", () => {
  it("read the very same AWJ catalogue calls as the DTC surface, with no wholesale pricing input", async () => {
    await getWholesaleProducts({ page: 2, limit: 12 });
    await getWholesaleProduct("mug", { expand: ["variants"] });
    await getWholesaleProductFilters({ in_category: "c1" });

    expect(mockFetchProducts).toHaveBeenCalledWith({ page: 2, limit: 12 });
    expect(mockFetchProduct).toHaveBeenCalledWith("mug");
    expect(mockFetchProductFilters).toHaveBeenCalledWith({ in_category: "c1" });
    // Nothing about the surface, channel or buyer reaches the AWJ catalogue
    // adapter, so wholesale pages show channel/retail prices, not trade prices.
    for (const call of [
      ...mockFetchProducts.mock.calls,
      ...mockFetchProduct.mock.calls,
      ...mockFetchProductFilters.mock.calls,
    ]) {
      expect(JSON.stringify(call)).not.toMatch(/wholesale|price_list|surface/i);
    }
  });
});

describe("AWJ-native commerce modules stay wholesale-free (no cart/price mapping across surfaces)", () => {
  const COMMERCE_DIR = join(__dirname, "../../commerce");
  const importLines = (file: string) =>
    readFileSync(join(COMMERCE_DIR, file), "utf-8")
      .split("\n")
      .filter((l) => /^\s*(import|export)\b.*\bfrom\b/.test(l));

  it("no module under lib/commerce imports the Spree wrapper, the SDK or the wholesale data layer", () => {
    const files = readdirSync(COMMERCE_DIR).filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
    );
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      for (const line of importLines(file)) {
        expect(line, file).not.toMatch(
          /@\/lib\/spree|@spree\/|data\/wholesale/,
        );
      }
    }
  });

  it("the AWJ cart/checkout adapters never mention a wholesale surface in executable code", () => {
    for (const file of ["cart.ts", "checkout.ts", "checkout-types.ts"]) {
      const code = readFileSync(join(COMMERCE_DIR, file), "utf-8")
        .split("\n")
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join("\n");
      expect(code, file).not.toMatch(/wholesale/i);
    }
  });
});
