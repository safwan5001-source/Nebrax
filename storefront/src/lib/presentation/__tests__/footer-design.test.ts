import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizePresentationConfig } from "../config";
import {
  FOOTER_DEFAULT_BACKDROP,
  footerContrastIssues,
  normalizeFooterExtras,
} from "../footer-design";

const dir = resolve(__dirname, "../../../../../tests/Fixtures/presentation");
const read = <T>(file: string): T =>
  JSON.parse(readFileSync(resolve(dir, file), "utf8")) as T;

const fixture = read<{
  cases: Array<{ name: string; input: unknown; expected: unknown }>;
}>("footer-design.json");
const contrast = read<{
  cases: Array<{
    name: string;
    config: {
      primaryColor: string;
      palette?: Record<string, string>;
      design: unknown;
    };
    expected: Array<{ field: string; code: string; ratio: number }>;
  }>;
}>("footer-contrast.json");

describe("footer layout / groups / design — shared fixture (V7e-1)", () => {
  for (const c of fixture.cases) {
    it(c.name, () => {
      const extras = normalizeFooterExtras(c.input);
      if (c.expected === null) expect(extras).toEqual({});
      else {
        expect(extras).toEqual(c.expected);
        expect(Object.keys(extras)).toEqual(Object.keys(c.expected as object));
      }
      const config = normalizePresentationConfig({ footer: c.input });
      for (const key of ["layout", "groups", "design"] as const) {
        if (c.expected && key in (c.expected as object)) {
          expect(config.footer[key]).toEqual(
            (c.expected as Record<string, unknown>)[key],
          );
        } else {
          expect(key in config.footer).toBe(false);
        }
      }
    });
  }
});

describe("footer — config integration (V7e-1)", () => {
  it("a footer without the new keys is unchanged and the version stays 3", () => {
    const plain = normalizePresentationConfig({});
    expect(Object.keys(plain.footer)).toEqual([
      "tagline",
      "showLogo",
      "copyright",
    ]);
    expect(plain.version).toBe(3);
    expect(
      normalizePresentationConfig({
        footer: { layout: "mega", groups: "x", design: { align: "left" } },
      }),
    ).toEqual(plain);
  });

  it("the new keys ride after the legacy fields", () => {
    const { footer } = normalizePresentationConfig({
      footer: {
        tagline: "Hi",
        layout: "centered",
        groups: [{ id: "g", title: "G" }],
        design: { align: "center" },
      },
    });
    expect(footer.tagline).toBe("Hi");
    expect(Object.keys(footer)).toEqual([
      "tagline",
      "showLogo",
      "copyright",
      "layout",
      "groups",
      "design",
    ]);
  });
});

describe("footer contrast — shared fixture (V7e-1)", () => {
  for (const c of contrast.cases) {
    it(c.name, () => {
      const { design, ...rest } = c.config;
      const issues = footerContrastIssues(
        normalizeFooterExtras({ design }).design,
        {
          primaryColor: rest.primaryColor,
          accentColor: null,
          palette: rest.palette,
        },
      );
      expect(issues.map((i) => [i.field, i.code])).toEqual(
        c.expected.map((e) => [e.field, e.code]),
      );
      issues.forEach((issue, i) =>
        expect(
          Math.abs(issue.ratio - (c.expected[i] as { ratio: number }).ratio),
        ).toBeLessThanOrEqual(0.006),
      );
    });
  }

  it("the default backdrop is the footer surface token", () => {
    expect(FOOTER_DEFAULT_BACKDROP).toBe("#111827");
    expect(
      readFileSync(resolve(__dirname, "../../../app/globals.css"), "utf8"),
    ).toContain("--store-footer: #111827;");
  });

  it("no design ⇒ no issues", () => {
    expect(
      footerContrastIssues(undefined, {
        primaryColor: "#12372a",
        accentColor: null,
      }),
    ).toEqual([]);
  });
});
