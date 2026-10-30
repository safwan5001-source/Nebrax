import { describe, expect, it } from "vitest";
import * as commerceSurface from "@/lib/commerce/surface";
import * as spreeSurface from "@/lib/spree/surface";

describe("surface vocabulary (H6 Batch C)", () => {
  it("keeps the exact surface set and the DTC default", () => {
    expect(commerceSurface.SURFACES).toEqual(["dtc", "wholesale"]);
    expect(commerceSurface.DEFAULT_SURFACE).toBe("dtc");
  });

  it("is a single source of truth: the Spree wrapper re-exports the same values", () => {
    expect(spreeSurface.SURFACES).toBe(commerceSurface.SURFACES);
    expect(spreeSurface.DEFAULT_SURFACE).toBe(commerceSurface.DEFAULT_SURFACE);
  });

  it("leaves the surface-dependent cookie and cache helpers unchanged", () => {
    expect(spreeSurface.cartCookieBaseName("dtc")).toBe("_spree_cart_token");
    expect(spreeSurface.cartCookieBaseName("wholesale")).toBe(
      "_spree_wholesale_cart_token",
    );
    expect(spreeSurface.cacheTagSuffix("dtc")).toBe("");
    expect(spreeSurface.cacheTagSuffix("wholesale")).toBe("-wholesale");
  });
});
