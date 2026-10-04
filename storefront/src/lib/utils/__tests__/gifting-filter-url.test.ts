import { describe, expect, it } from "vitest";
import {
  clearGiftingFilters,
  countGiftingFilters,
  isDeliverToday,
  selectedBrand,
  selectedFacetSlugs,
  toggleBrand,
  toggleDeliverToday,
  toggleFacetValue,
} from "../gifting-filter-url";

const params = (query: string) => new URLSearchParams(query);

describe("gifting filter URL edits (FLOWERS-H10)", () => {
  it("adds and removes facet values as an OR list, leaving other keys alone", () => {
    const start = params("q=rose&sort=name&collection=roses");
    const a = toggleFacetValue(start, "occasion", "birthday");
    expect(a.get("facet[occasion]")).toBe("birthday");
    const b = toggleFacetValue(a, "occasion", "wedding");
    expect(b.get("facet[occasion]")).toBe("birthday,wedding");
    const c = toggleFacetValue(b, "occasion", "birthday");
    expect(c.get("facet[occasion]")).toBe("wedding");
    const d = toggleFacetValue(c, "occasion", "wedding");
    expect(d.has("facet[occasion]")).toBe(false);
    expect(d.get("q")).toBe("rose");
    expect(d.get("sort")).toBe("name");
    expect(d.get("collection")).toBe("roses");
  });

  it("does not mutate its input and ignores unsafe tokens", () => {
    const start = params("facet[occasion]=birthday");
    toggleFacetValue(start, "occasion", "wedding");
    expect(start.get("facet[occasion]")).toBe("birthday");
    expect(toggleFacetValue(start, "occasion", "Bad Slug!").toString()).toBe(
      start.toString(),
    );
    expect(
      selectedFacetSlugs(params("facet[occasion]=ok,BAD,also-ok"), "occasion"),
    ).toEqual(["ok", "also-ok"]);
  });

  it("toggles one brand at a time", () => {
    const a = toggleBrand(params(""), "b1");
    expect(selectedBrand(a)).toBe("b1");
    expect(selectedBrand(toggleBrand(a, "b2"))).toBe("b2");
    expect(selectedBrand(toggleBrand(a, "b1"))).toBeNull();
  });

  it("toggles deliver-today", () => {
    const on = toggleDeliverToday(params("q=x"));
    expect(on.get("deliver_today")).toBe("true");
    expect(isDeliverToday(on)).toBe(true);
    expect(isDeliverToday(params("deliver_today=1"))).toBe(true);
    expect(isDeliverToday(params("deliver_today=no"))).toBe(false);
    expect(toggleDeliverToday(on).has("deliver_today")).toBe(false);
  });

  it("clear-all removes only the gifting filters (collection and listing state stay)", () => {
    const next = clearGiftingFilters(
      params(
        "q=rose&sort=name&collection=roses&facet[occasion]=a,b&facet[recipient]=mom&brand_id=b1&deliver_today=true&option=1",
      ),
    );
    expect([...next.keys()].sort()).toEqual([
      "collection",
      "option",
      "q",
      "sort",
    ]);
  });

  it("counts every selected value, brand and deliver-today", () => {
    expect(countGiftingFilters(params("q=x&collection=roses"))).toBe(0);
    expect(
      countGiftingFilters(
        params(
          "facet[occasion]=a,b&facet[recipient]=mom&brand_id=b1&deliver_today=true",
        ),
      ),
    ).toBe(5);
  });
});
