import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DISCOVERY_TEMPLATES, resolveDiscoveryDisplay } from "../presentation/discovery-templates";
import { normalizeOptionalSectionContent } from "../presentation/section-content";

/**
 * AWJ-VD-H1 / VD-4a — the admin twin of the discovery display contract. The storefront suite pins the closed lists
 * against PHP; here: the template module is byte-identical, and the admin normalizer emits the fixture's exact output
 * and key order (the builder re-normalizes on every edit, so a dropped key here would erase a merchant's setting).
 */
const repo = (path: string) => readFileSync(resolve(process.cwd(), "..", path), "utf8");

type Case = { name: string; type: string; input: unknown; expected: Record<string, unknown> | null };
const cases = (JSON.parse(repo("tests/Fixtures/presentation/data-sections.json")) as { cases: Case[] }).cases.filter(
  (c) => c.type === "discovery",
);

describe("discovery display contract — admin twin (VD-4a)", () => {
  it("discovery-templates.ts is byte-identical to the storefront twin", () => {
    expect(repo("web/src/modules/store-experience-builder/presentation/discovery-templates.ts")).toBe(
      repo("storefront/src/lib/presentation/discovery-templates.ts"),
    );
  });

  it("the template registry equals the shared fixture", () => {
    const fixture = JSON.parse(repo("tests/Fixtures/presentation/discovery-templates.json")) as {
      templates: Record<string, unknown>;
    };
    expect(DISCOVERY_TEMPLATES).toEqual(fixture.templates);
    expect(Object.keys(DISCOVERY_TEMPLATES)).toEqual(Object.keys(fixture.templates));
  });

  for (const testCase of cases) {
    it(`fixture: ${testCase.name}`, () => {
      const actual = normalizeOptionalSectionContent("discovery", testCase.input) as Record<string, unknown> | undefined;
      if (testCase.expected === null) {
        expect(actual).toBeUndefined();
        return;
      }
      expect(actual).toEqual(testCase.expected);
      expect(Object.keys(actual ?? {})).toEqual(Object.keys(testCase.expected));
    });
  }

  it("resolves a template the same way as the storefront", () => {
    const resolved = resolveDiscoveryDisplay({
      title: "",
      axis: "facet",
      dimension: "occasion",
      display: "tiles",
      template: "market-icons",
    });
    expect(resolved.layout).toBe("icon-grid");
    expect(resolved.columns).toEqual({ mobile: 4, tablet: 6, desktop: 8 });
    expect(resolved.visualTemplate).toEqual({ shape: "rounded", size: "sm" });
  });
});
