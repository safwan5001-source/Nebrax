import { describe, expect, it } from "vitest";
import {
  publishedHomeStackClass,
  publishedPageContainerPaddingClass,
  publishedProductCardBodyClass,
} from "../public-rhythm";

describe("published rhythm", () => {
  it("keeps the current homepage rhythm unless density is compact", () => {
    expect(publishedHomeStackClass(null)).toBe(
      "space-y-8 py-4 md:space-y-10 md:py-6",
    );
    expect(publishedHomeStackClass("comfortable")).toBe(
      "space-y-8 py-4 md:space-y-10 md:py-6",
    );
    expect(publishedHomeStackClass("unknown")).toBe(
      "space-y-8 py-4 md:space-y-10 md:py-6",
    );
    expect(publishedHomeStackClass("compact")).toBe("space-y-6 py-3");
  });

  it("changes only card padding for a published compact card", () => {
    expect(publishedProductCardBodyClass(undefined)).toContain("p-3");
    expect(publishedProductCardBodyClass("standard")).toContain("p-3");
    expect(publishedProductCardBodyClass("compact")).toContain("p-2.5");
    expect(publishedProductCardBodyClass("compact")).not.toContain("p-3");
  });

  /**
   * CUST-H3-3 — the Product/Category page shells' own outer padding.
   * Mirrors the Customizer Canvas's `pageContainerPaddingClass()`
   * (`web/src/modules/store-experience-builder/presentation/tokens.ts`)
   * exactly, so this is the resolver both the Product and Category page
   * now call, and the single place Canvas/Published parity for this
   * surface is proven.
   */
  it("gives the Product/Category page shells a real compact padding, unknown values failing closed", () => {
    expect(publishedPageContainerPaddingClass(null)).toBe("py-5 md:py-6");
    expect(publishedPageContainerPaddingClass(undefined)).toBe(
      "py-5 md:py-6",
    );
    expect(publishedPageContainerPaddingClass("comfortable")).toBe(
      "py-5 md:py-6",
    );
    expect(publishedPageContainerPaddingClass("unknown")).toBe(
      "py-5 md:py-6",
    );
    expect(publishedPageContainerPaddingClass("compact")).toBe("py-3");
  });
});
