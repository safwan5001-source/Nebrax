import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DISCOVERY_DISPLAY_DEFAULTS,
  DISCOVERY_TEMPLATE_IDS,
  DISCOVERY_TEMPLATES,
  resolveDiscoveryDisplay,
} from "../discovery-templates";
import {
  DISCOVERY_ALIGNS,
  DISCOVERY_CARD_STYLES,
  DISCOVERY_COLUMN_RANGES,
  DISCOVERY_CONTENT_ORDERS,
  DISCOVERY_GAPS,
  DISCOVERY_LAYOUTS,
  DISCOVERY_MAX_ITEMS_MAX,
  DISCOVERY_MAX_ITEMS_MIN,
  DISCOVERY_ROWS_MAX,
  DISCOVERY_ROWS_MIN,
  DISCOVERY_TEXT_POSITIONS,
  DISCOVERY_VALUE_ORDERS,
  type DiscoveryContent,
  normalizeOptionalSectionContent,
} from "../section-content";

/**
 * AWJ-VD-H1 / VD-4a — the discovery display contract: PHP `StorefrontPresentationNormalizer` +
 * `DiscoveryTemplateRegistry` are the authority, pinned here through the shared fixtures and by parsing the PHP source.
 */
const repo = (path: string) =>
  readFileSync(resolve(process.cwd(), "..", path), "utf8");

type Case = {
  name: string;
  type: string;
  input: unknown;
  expected: Record<string, unknown> | null;
};
const cases = (
  JSON.parse(repo("tests/Fixtures/presentation/data-sections.json")) as {
    cases: Case[];
  }
).cases.filter((c) => c.type === "discovery");
const templatesFixture = JSON.parse(
  repo("tests/Fixtures/presentation/discovery-templates.json"),
) as { templates: Record<string, Record<string, unknown>> };

const normalizer = repo(
  "app/Support/Commerce/StorefrontPresentationNormalizer.php",
);

function phpList(constant: string): string[] {
  const match = normalizer.match(
    new RegExp(`const ${constant} = \\[([\\s\\S]*?)\\];`),
  );
  if (!match) throw new Error(`constant ${constant} not found`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

function phpInt(constant: string): number {
  const match = normalizer.match(new RegExp(`const ${constant} = (\\d+);`));
  if (!match) throw new Error(`constant ${constant} not found`);
  return Number(match[1]);
}

describe("discovery display contract (VD-4a)", () => {
  it("emits keys in the canonical order PHP emits them (byte-identical documents)", () => {
    for (const testCase of cases) {
      if (testCase.expected === null) continue;
      const actual = normalizeOptionalSectionContent(
        "discovery",
        testCase.input,
      ) as Record<string, unknown>;
      expect(Object.keys(actual), testCase.name).toEqual(
        Object.keys(testCase.expected),
      );
      const columns = testCase.expected.columns as
        | Record<string, unknown>
        | undefined;
      if (columns) {
        expect(Object.keys(actual.columns as object), testCase.name).toEqual(
          Object.keys(columns),
        );
      }
    }
  });

  it("closed lists and ranges match the PHP authority", () => {
    expect([...DISCOVERY_LAYOUTS]).toEqual(phpList("DISCOVERY_LAYOUTS"));
    expect([...DISCOVERY_GAPS]).toEqual(phpList("DISCOVERY_GAPS"));
    expect([...DISCOVERY_TEXT_POSITIONS]).toEqual(
      phpList("DISCOVERY_TEXT_POSITIONS"),
    );
    expect([...DISCOVERY_CONTENT_ORDERS]).toEqual(
      phpList("DISCOVERY_CONTENT_ORDERS"),
    );
    expect([...DISCOVERY_VALUE_ORDERS]).toEqual(
      phpList("DISCOVERY_VALUE_ORDERS"),
    );
    expect([...DISCOVERY_CARD_STYLES]).toEqual(
      phpList("DISCOVERY_CARD_STYLES"),
    );
    expect([...DISCOVERY_ALIGNS]).toEqual(phpList("DISCOVERY_ALIGNS"));
    expect(DISCOVERY_ROWS_MIN).toBe(phpInt("DISCOVERY_ROWS_MIN"));
    expect(DISCOVERY_ROWS_MAX).toBe(phpInt("DISCOVERY_ROWS_MAX"));
    expect(DISCOVERY_MAX_ITEMS_MIN).toBe(phpInt("DISCOVERY_MAX_ITEMS_MIN"));
    expect(DISCOVERY_MAX_ITEMS_MAX).toBe(phpInt("DISCOVERY_MAX_ITEMS_MAX"));
    const ranges = normalizer.match(
      /const DISCOVERY_COLUMN_RANGES = \[([^;]*)\];/,
    )?.[1];
    expect(ranges).toBeDefined();
    const parsed = Object.fromEntries(
      [...(ranges ?? "").matchAll(/'(\w+)' => \[(\d+), (\d+)\]/g)].map((m) => [
        m[1],
        [Number(m[2]), Number(m[3])],
      ]),
    );
    expect(parsed).toEqual(DISCOVERY_COLUMN_RANGES);
  });

  it("the template registry equals the shared fixture: ids, order and values", () => {
    expect(DISCOVERY_TEMPLATES).toEqual(templatesFixture.templates);
    expect(DISCOVERY_TEMPLATE_IDS).toEqual(
      Object.keys(templatesFixture.templates),
    );
    for (const [id, template] of Object.entries(DISCOVERY_TEMPLATES)) {
      expect(Object.keys(template), id).toEqual(
        Object.keys(templatesFixture.templates[id]),
      );
    }
  });

  it("every template value is itself valid content (the normalizer keeps it unchanged)", () => {
    for (const [id, template] of Object.entries(DISCOVERY_TEMPLATES)) {
      const normalized = normalizeOptionalSectionContent("discovery", {
        dimension: "occasion",
        template: id,
        ...template,
      }) as Record<string, unknown>;
      expect(normalized, id).toMatchObject({ template: id, ...template });
    }
  });
});

describe("resolveDiscoveryDisplay (VD-4a)", () => {
  const base: DiscoveryContent = {
    title: "",
    axis: "facet",
    dimension: "occasion",
    display: "tiles",
  };

  it("a legacy section resolves to no layout (the renderer keeps tiles/chips) and system defaults", () => {
    const resolved = resolveDiscoveryDisplay(base);
    expect(resolved.layout).toBeNull();
    expect(resolved).toMatchObject({
      columns: DISCOVERY_DISPLAY_DEFAULTS.columns,
      rows: 1,
      gap: "normal",
      textPosition: "below",
      contentOrder: "media-first",
      valueOrder: "merchant",
      cardStyle: "plain",
      align: "center",
      showCounts: false,
      maxItems: 12,
    });
    expect(resolved.visualSection).toEqual({});
    expect(resolved.visualTemplate).toEqual({});
  });

  it("a template fills what the section leaves out; an explicit value always wins", () => {
    const resolved = resolveDiscoveryDisplay({
      ...base,
      template: "boutique-arches",
      columns: { mobile: 1 },
      cardStyle: "elevated",
      shape: "circle",
    });
    expect(resolved.layout).toBe("image-cards");
    expect(resolved.columns).toEqual({ mobile: 1, tablet: 3, desktop: 4 });
    expect(resolved.cardStyle).toBe("elevated");
    expect(resolved.textPosition).toBe("below");
    // Shape/size are handed to the facet-visual chain, not resolved here (D-08): the section's explicit value is its
    // `section` context (above the value), the template's is its `template` context (below the value).
    expect(resolved.visualSection).toEqual({ shape: "circle" });
    expect(resolved.visualTemplate).toEqual({ shape: "arch", size: "lg" });
  });

  it("the carousel template brings two rows; an unknown template id is ignored", () => {
    expect(
      resolveDiscoveryDisplay({ ...base, template: "swipe-rail" }).rows,
    ).toBe(2);
    expect(
      resolveDiscoveryDisplay({
        ...base,
        template: "nope" as DiscoveryContent["template"],
      }).layout,
    ).toBeNull();
    expect(
      resolveDiscoveryDisplay({
        ...base,
        template: "constructor" as DiscoveryContent["template"],
      }).layout,
    ).toBeNull();
  });
});
