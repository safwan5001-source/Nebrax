import { describe, expect, it } from "vitest";
import { ICON_KEYS } from "../icon-registry";
import { normalizeOptionalSectionContent } from "../section-content";
import { LAYOUTS, SECTION_DESIGN_CAPABILITIES } from "../section-design";

/**
 * CUST-HV V9b — benefits items carry an optional curated icon. Twin of
 * `web/.../__tests__/benefits-content.test.ts` and of the PHP normaliser's
 * `benefits_item_icon_*` tests; all three must agree.
 */
describe("benefits item icon", () => {
  const norm = (items: unknown[]) =>
    normalizeOptionalSectionContent("benefits", { items });

  it("keeps a registry key and stores nothing when there is none", () => {
    expect(
      norm([
        { id: "a", title: "Fast", body: "", icon: "truck" },
        { id: "b", title: "Safe", body: "" },
      ]),
    ).toEqual({
      items: [
        { id: "a", title: "Fast", body: "", icon: "truck" },
        { id: "b", title: "Safe", body: "" },
      ],
    });
  });

  it("accepts every registry key", () => {
    for (const key of ICON_KEYS) {
      expect(norm([{ id: "a", title: "x", body: "", icon: key }])).toEqual({
        items: [{ id: "a", title: "x", body: "", icon: key }],
      });
    }
  });

  it("drops unknown, wrong-case, empty and non-string icons without dropping the item", () => {
    for (const icon of ["rocket", "Truck", "", "<svg/>", 3, null, ["truck"]]) {
      expect(norm([{ id: "a", title: "x", body: "", icon }])).toEqual({
        items: [{ id: "a", title: "x", body: "" }],
      });
    }
  });

  it("is idempotent", () => {
    const once = norm([{ id: "a", title: "x", body: "y", icon: "gift" }]);
    expect(normalizeOptionalSectionContent("benefits", once)).toEqual(once);
  });
});

describe("benefits layout", () => {
  it("is a closed list in the design capability", () => {
    expect(LAYOUTS.benefits).toEqual([
      "flat",
      "columns-2",
      "columns-3",
      "columns-4",
    ]);
    expect(SECTION_DESIGN_CAPABILITIES.benefits.layout).toEqual(
      LAYOUTS.benefits,
    );
  });
});
