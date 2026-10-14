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

describe("parseListingFacets — facet visuals (AWJ-VD-H1 VD-1c, D1)", () => {
  const VISUAL = "0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d5e";
  const FACET_VISUAL = "2d0b8e4a-5f5c-4c75-9e9a-0b3c4d5e6f70";
  const MEDIA = "1c9a7d3f-4e4b-4b64-8d8f-9a2b3c4d5e6f";
  const OTHER = "3e1c9f5b-6a6d-4d86-8fab-1c4d5e6f7081";
  const origin = (visualId: string, mediaId: string, file: string) =>
    `/store/v1/media/facet-visuals/${visualId}/${mediaId}/${file}`;
  const sources = (visualId: string, mediaId: string) => [
    {
      width: 160,
      format: "webp",
      src: origin(visualId, mediaId, "thumb-160.webp"),
    },
    {
      width: 160,
      format: "jpg",
      src: origin(visualId, mediaId, "thumb-160.jpg"),
    },
    { width: 480, format: "webp", src: origin(visualId, mediaId, "480w.webp") },
  ];
  const withVisual = (valueVisual: unknown, facetVisual: unknown = null) => ({
    facets: [
      facet({
        visual: facetVisual,
        values: [
          {
            slug: "birthday",
            name: "عيد ميلاد",
            name_en: "Birthday",
            count: 3,
            selected: false,
            visual: valueVisual,
          },
        ],
      }),
    ],
  });

  it("re-normalizes the documents and rewrites every source to the proxy", () => {
    const parsed = parseListingFacets(
      withVisual(
        {
          image: {
            mediaId: MEDIA,
            focal: { x: 30, y: 40 },
            zoom: 1.5,
            sources: sources(VISUAL, MEDIA),
          },
          shape: "arch",
        },
        {
          self: {
            image: { mediaId: MEDIA, sources: sources(FACET_VISUAL, MEDIA) },
            icon: "gift",
          },
          defaults: { icon: "gift", shape: "rounded", size: "lg" },
        },
      ),
      "en",
    );
    const group = parsed.groups[0];
    const value = group.values[0];

    expect(value.visual).toEqual({
      image: { mediaId: MEDIA, focal: { x: 30, y: 40 }, zoom: 1.5 },
      shape: "arch",
    });
    expect(value.imageSources).toEqual([
      {
        width: 160,
        format: "webp",
        src: `/api/storefront/media/facet-visuals/${VISUAL}/${MEDIA}/thumb-160.webp`,
      },
      {
        width: 160,
        format: "jpg",
        src: `/api/storefront/media/facet-visuals/${VISUAL}/${MEDIA}/thumb-160.jpg`,
      },
      {
        width: 480,
        format: "webp",
        src: `/api/storefront/media/facet-visuals/${VISUAL}/${MEDIA}/480w.webp`,
      },
    ]);
    expect(group.visual).toEqual({
      self: { image: { mediaId: MEDIA }, icon: "gift" },
      defaults: { icon: "gift", shape: "rounded", size: "lg" },
    });
    expect(group.selfImageSources?.map((s) => s.src)).toEqual(
      sources(FACET_VISUAL, MEDIA).map((s) =>
        s.src.replace("/store/v1/", "/api/storefront/"),
      ),
    );
  });

  it("N15 — every src it returns is a facet-visuals proxy path", () => {
    const hostile = [
      ...sources(VISUAL, MEDIA),
      {
        width: 480,
        format: "webp",
        src: `/store/v1/media/customizer/${MEDIA}/480w.webp`,
      },
      { width: 480, format: "webp", src: `/store/v1/media/${MEDIA}` },
      { width: 480, format: "webp", src: "https://evil.example/x.webp" },
      {
        width: 480,
        format: "webp",
        src: origin(VISUAL, MEDIA, "original.jpg"),
      },
      {
        width: 480,
        format: "webp",
        src: `/api/commerce/workspace/storefront-media/${MEDIA}?signature=x`,
      },
      { width: 480, format: "webp", src: "javascript:alert(1)" },
    ];
    const parsed = parseListingFacets(
      withVisual(
        { image: { mediaId: MEDIA, sources: hostile } },
        { self: { image: { mediaId: MEDIA, sources: hostile } } },
      ),
      "en",
    );
    const srcs = [
      ...(parsed.groups[0].selfImageSources ?? []),
      ...(parsed.groups[0].values[0].imageSources ?? []),
    ].map((s) => s.src);
    expect(srcs).toHaveLength(6);
    for (const src of srcs) {
      expect(src.startsWith("/api/storefront/media/facet-visuals/")).toBe(true);
    }
  });

  it("drops sources of another media, a mismatched format, or a malformed width", () => {
    const parsed = parseListingFacets(
      withVisual({
        image: {
          mediaId: MEDIA,
          sources: [
            {
              width: 480,
              format: "webp",
              src: origin(VISUAL, OTHER, "480w.webp"),
            },
            {
              width: 480,
              format: "jpg",
              src: origin(VISUAL, MEDIA, "480w.webp"),
            },
            {
              width: 0,
              format: "webp",
              src: origin(VISUAL, MEDIA, "480w.webp"),
            },
            {
              width: 1.5,
              format: "webp",
              src: origin(VISUAL, MEDIA, "480w.webp"),
            },
            {
              width: 99999,
              format: "webp",
              src: origin(VISUAL, MEDIA, "480w.webp"),
            },
            {
              width: "480",
              format: "webp",
              src: origin(VISUAL, MEDIA, "480w.webp"),
            },
            {
              width: 480,
              format: "png",
              src: origin(VISUAL, MEDIA, "480w.webp"),
            },
            {
              width: 768,
              format: "jpg",
              src: origin(VISUAL, MEDIA, "768w.jpg"),
            },
          ],
        },
        icon: "cake",
      }),
      "en",
    );
    expect(parsed.groups[0].values[0].imageSources).toEqual([
      {
        width: 768,
        format: "jpg",
        src: `/api/storefront/media/facet-visuals/${VISUAL}/${MEDIA}/768w.jpg`,
      },
    ]);
  });

  it("removes an image left without sources, so the resolver falls back", () => {
    const iconOnly = parseListingFacets(
      withVisual(
        { image: { mediaId: MEDIA, sources: [] }, icon: "cake" },
        { self: { image: { mediaId: MEDIA } }, defaults: { shape: "arch" } },
      ),
      "en",
    );
    expect(iconOnly.groups[0].values[0].visual).toEqual({ icon: "cake" });
    expect(iconOnly.groups[0].values[0].imageSources).toBeUndefined();
    expect(iconOnly.groups[0].visual).toEqual({ defaults: { shape: "arch" } });
    expect(iconOnly.groups[0].selfImageSources).toBeUndefined();

    const nothing = parseListingFacets(
      withVisual(
        { image: { mediaId: MEDIA } },
        { self: { image: { mediaId: MEDIA } } },
      ),
      "en",
    );
    expect(nothing.groups[0].values[0]).not.toHaveProperty("visual");
    expect(nothing.groups[0]).not.toHaveProperty("visual");
  });

  it("keeps legacy payloads (visual null or absent) byte-for-byte as before", () => {
    const expected = {
      groups: [
        {
          key: "occasion",
          systemKey: "occasion",
          name: "Occasion",
          values: [{ slug: "birthday", name: "Birthday", count: 3 }],
        },
      ],
      brands: [],
    };
    expect(parseListingFacets({ facets: [facet()] }, "en")).toEqual(expected);
    expect(parseListingFacets(withVisual(null, null), "en")).toEqual(expected);
    expect(parseListingFacets(withVisual({}, {}), "en")).toEqual(expected);
    expect(parseListingFacets(withVisual("x", 3), "en")).toEqual(expected);
  });
});

describe("parseListingFacets — visibility and canonical sources (VD-1c review)", () => {
  const VISUAL = "0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d5e";
  const MEDIA = "1c9a7d3f-4e4b-4b64-8d8f-9a2b3c4d5e6f";
  const src = (file: string) =>
    `/store/v1/media/facet-visuals/${VISUAL}/${MEDIA}/${file}`;
  const imageVisual = (sources: unknown[]) => ({
    image: { mediaId: MEDIA, sources },
    icon: "cake",
  });

  it("gives no visual to a value listed only because it is selected, nor to a facet without a counted value", () => {
    const parsed = parseListingFacets(
      {
        facets: [
          facet({
            visual: { self: { icon: "gift" }, defaults: { shape: "arch" } },
            values: [
              {
                slug: "birthday",
                name: "Birthday",
                count: 0,
                selected: true,
                visual: imageVisual([
                  { width: 480, format: "webp", src: src("480w.webp") },
                ]),
              },
            ],
          }),
        ],
      },
      "en",
    );
    const group = parsed.groups[0];
    expect(group.values[0]).toEqual({
      slug: "birthday",
      name: "Birthday",
      count: 0,
    });
    expect(group).not.toHaveProperty("visual");
  });

  it("accepts only the canonical origin path, never a proxy-looking or dot-segment path", () => {
    const parsed = parseListingFacets(
      {
        facets: [
          facet({
            values: [
              {
                slug: "birthday",
                name: "Birthday",
                count: 2,
                selected: false,
                visual: imageVisual([
                  {
                    width: 480,
                    format: "webp",
                    src: `/api/storefront/media/facet-visuals/../${MEDIA}/x.webp`,
                  },
                  {
                    width: 480,
                    format: "webp",
                    src: `/api/storefront/media/facet-visuals/${VISUAL}/${MEDIA}/480w.webp`,
                  },
                  {
                    width: 480,
                    format: "webp",
                    src: `/store/v1/media/facet-visuals/${VISUAL}/${MEDIA}/../480w.webp`,
                  },
                  { width: 768, format: "webp", src: src("768w.webp") },
                ]),
              },
            ],
          }),
        ],
      },
      "en",
    );
    expect(parsed.groups[0].values[0].imageSources).toEqual([
      {
        width: 768,
        format: "webp",
        src: `/api/storefront/media/facet-visuals/${VISUAL}/${MEDIA}/768w.webp`,
      },
    ]);
  });
});
