import { describe, expect, it } from "vitest";
import {
  hasListingFacets,
  MAX_FACET_GROUPS,
  MAX_VALUES_PER_GROUP,
  parseListingFacets,
} from "../listing-facets";

const BRAND = "0a1b2c3d-1111-4222-8333-444455556666";

const facet = (over: Record<string, unknown> = {}) => ({
  key: "occasion",
  system_key: "occasion",
  name: "المناسبة",
  name_en: "Occasion",
  values: [
    {
      slug: "birthday",
      name: "عيد ميلاد",
      name_en: "Birthday",
      count: 3,
      selected: false,
    },
  ],
  ...over,
});

describe("parseListingFacets (FLOWERS-H10)", () => {
  it("returns nothing for missing or malformed meta", () => {
    for (const meta of [undefined, null, {}, { facets: "x", brands: 3 }]) {
      expect(parseListingFacets(meta as never, "en")).toEqual({
        groups: [],
        brands: [],
      });
    }
    expect(hasListingFacets({ groups: [], brands: [] })).toBe(false);
  });

  it("localizes names and keeps counts", () => {
    const meta = { facets: [facet()] };
    expect(parseListingFacets(meta, "en").groups[0]).toEqual({
      key: "occasion",
      systemKey: "occasion",
      name: "Occasion",
      values: [{ slug: "birthday", name: "Birthday", count: 3 }],
    });
    const ar = parseListingFacets(meta, "ar").groups[0];
    expect(ar.name).toBe("المناسبة");
    expect(ar.values[0].name).toBe("عيد ميلاد");
  });

  it("puts occasion then recipient first and keeps merchant order after", () => {
    const meta = {
      facets: [
        facet({
          key: "flower",
          system_key: null,
          name: "Flower",
          name_en: null,
        }),
        facet({
          key: "recipient",
          system_key: "recipient",
          name: "Recipient",
          name_en: null,
        }),
        facet({
          key: "occasion",
          system_key: "occasion",
          name: "Occasion",
          name_en: null,
        }),
        facet({
          key: "colour",
          system_key: null,
          name: "Colour",
          name_en: null,
        }),
      ],
    };
    expect(parseListingFacets(meta, "en").groups.map((g) => g.key)).toEqual([
      "occasion",
      "recipient",
      "flower",
      "colour",
    ]);
  });

  it("drops invalid keys, slugs, names, counts and empty groups; dedupes keys", () => {
    const meta = {
      facets: [
        facet({ key: "Bad Key" }),
        facet({ name: "  ", name_en: null }),
        facet({ values: [{ slug: "UPPER", name: "x", count: 1 }] }),
        facet({ values: [{ slug: "ok", name: "x", count: -1 }] }),
        facet({ values: [{ slug: "ok", name: "x", count: "2" }] }),
        facet({ values: [{ slug: "ok", name: "x", count: Number.NaN }] }),
        facet({
          key: "good",
          values: [{ slug: "fine", name: "Fine", count: 2 }],
        }),
        facet({
          key: "good",
          values: [{ slug: "dup", name: "Dup", count: 2 }],
        }),
        "junk",
        null,
      ],
    };
    const groups = parseListingFacets(meta, "en").groups;
    expect(groups.map((g) => g.key)).toEqual(["good"]);
    expect(groups[0].values.map((v) => v.slug)).toEqual(["fine"]);
  });

  it("keeps a zero-count value only while it is selected", () => {
    const meta = {
      facets: [
        facet({
          values: [
            { slug: "a", name: "A", count: 0, selected: false },
            { slug: "b", name: "B", count: 0, selected: true },
            { slug: "c", name: "C", count: 4 },
          ],
        }),
      ],
    };
    expect(
      parseListingFacets(meta, "en").groups[0].values.map((v) => v.slug),
    ).toEqual(["b", "c"]);
  });

  it("bounds groups and values", () => {
    const many = Array.from({ length: MAX_FACET_GROUPS + 5 }, (_, i) =>
      facet({ key: `k${i}`, system_key: null, name: `K${i}` }),
    );
    expect(parseListingFacets({ facets: many }, "en").groups).toHaveLength(
      MAX_FACET_GROUPS,
    );
    const values = Array.from(
      { length: MAX_VALUES_PER_GROUP + 10 },
      (_, i) => ({
        slug: `v${i}`,
        name: `V${i}`,
        count: 1,
      }),
    );
    expect(
      parseListingFacets({ facets: [facet({ values })] }, "en").groups[0]
        .values,
    ).toHaveLength(MAX_VALUES_PER_GROUP);
  });

  it("parses brands: UUID ids only, positive counts, selected brand kept at zero", () => {
    const meta = {
      brands: [
        { id: BRAND, name: "Rosa", count: 5 },
        { id: "not-a-uuid", name: "Bad", count: 5 },
        { id: "11111111-1111-4111-8111-111111111111", name: "Gone", count: 0 },
        {
          id: "22222222-2222-4222-8222-222222222222",
          name: "Picked",
          count: 0,
          selected: true,
        },
        { id: "33333333-3333-4333-8333-333333333333", name: " ", count: 2 },
      ],
    };
    expect(parseListingFacets(meta, "en").brands).toEqual([
      { id: BRAND, name: "Rosa", count: 5 },
      { id: "22222222-2222-4222-8222-222222222222", name: "Picked", count: 0 },
    ]);
  });
});
