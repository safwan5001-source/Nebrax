import { describe, expect, it } from "vitest";
import {
  publishedHomeStackClass,
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
});
