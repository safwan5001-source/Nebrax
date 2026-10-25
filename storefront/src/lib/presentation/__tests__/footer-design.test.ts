import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizePresentationConfig } from "../config";
import {
  parseHex,
  passes,
  solidInterval,
  worstRatioForHex,
} from "../contrast-engine";
import {
  FOOTER_DEFAULT_BACKDROP,
  footerContrastIssues,
  normalizeFooterExtras,
  resolveFooterDesign,
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
      for (const key of [
        "layout",
        "groups",
        "design",
        "paymentLogos",
      ] as const) {
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
      for (const [i, issue] of issues.entries()) {
        expect(
          Math.abs(issue.ratio - (c.expected[i] as { ratio: number }).ratio),
        ).toBeLessThanOrEqual(0.006);
      }
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

describe("resolveFooterDesign (V7e-2)", () => {
  const ctx = { primaryColor: "#12372a", accentColor: null };

  it("no design ⇒ no style at all and the default structure", () => {
    expect(resolveFooterDesign(undefined, ctx)).toEqual({
      spacing: { top: "md", bottom: "md" },
      logoSize: undefined,
      align: undefined,
      designed: false,
    });
  });

  it("a structural-only design emits no colour variables", () => {
    const r = resolveFooterDesign(
      { spacing: { top: "lg" }, align: "center", logo: { size: "sm" } },
      ctx,
    );
    expect(r.style).toBeUndefined();
    expect(r).toMatchObject({
      spacing: { top: "lg", bottom: "md" },
      align: "center",
      logoSize: "sm",
      designed: true,
    });
  });

  it("a designed background derives every colour it did not choose, each proven ≥ 4.5:1", () => {
    for (const bg of [
      "#ffffff",
      "#f8fafc",
      "#fde68a",
      "#777777",
      "#12372a",
      "#0f172a",
      "#000000",
      "#2563eb",
      "#c2410c",
    ]) {
      const r = resolveFooterDesign(
        { surface: { background: { hex: bg } } },
        ctx,
      );
      const s = r.style as Record<string, string>;
      expect(s["--store-footer"]).toBe(bg);
      const rgb = parseHex(bg) as [number, number, number];
      for (const key of [
        "--store-footer-foreground",
        "--store-footer-muted",
        "--store-footer-link",
      ]) {
        expect(
          passes(worstRatioForHex(s[key] as string, solidInterval(rgb))),
        ).toBe(true);
      }
    }
  });

  it("explicit colours override only the token they name", () => {
    const r = resolveFooterDesign(
      { link: { hex: "#e2e8f0" }, heading: { hex: "#ffffff" } },
      ctx,
    );
    expect(r.style).toEqual({
      "--store-footer-foreground": "#ffffff",
      "--store-footer-link": "#e2e8f0",
    });
  });

  it("explicit colours win over the derived ones on a designed background", () => {
    const r = resolveFooterDesign(
      {
        surface: { background: { hex: "#0f172a" } },
        heading: { hex: "#fde68a" },
        divider: { color: { hex: "#334155" } },
      },
      ctx,
    );
    const s = r.style as Record<string, string>;
    expect(s["--store-footer-foreground"]).toBe("#fde68a");
    expect(s["--store-footer-border"]).toBe("#334155");
    expect(s["--store-footer"]).toBe("#0f172a");
  });

  it("a role resolves through the palette; every emitted value is a hex", () => {
    const r = resolveFooterDesign(
      { surface: { background: { role: "brand" } } },
      ctx,
    );
    const s = r.style as Record<string, string>;
    expect(s["--store-footer"]).toBe("#12372a");
    for (const v of Object.values(s)) expect(v).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
