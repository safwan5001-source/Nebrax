import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizePresentationConfig } from "../presentation/config";
import { normalizeGlobalTokens, resolveGlobalTokens } from "../presentation/global-tokens";

const fixture = JSON.parse(
  readFileSync(
    resolve(
      __dirname,
      "../../../../../tests/Fixtures/presentation/global-tokens.json",
    ),
    "utf8",
  ),
) as {
  cases: Array<{
    name: string;
    input: Record<string, unknown>;
    expected: Record<string, unknown>;
  }>;
};

const KEYS = ["typography", "surfaces", "layout", "motion"] as const;

describe("global tokens — shared fixture (V5e-2a)", () => {
  for (const c of fixture.cases) {
    it(c.name, () => {
      const out = normalizeGlobalTokens(c.input);
      expect(out).toEqual(c.expected);
      expect(Object.keys(out)).toEqual(Object.keys(c.expected));
      for (const key of Object.keys(c.expected)) {
        expect(Object.keys((out as Record<string, object>)[key])).toEqual(
          Object.keys(c.expected[key] as object),
        );
      }
      const config = normalizePresentationConfig(c.input);
      for (const key of KEYS) {
        if (key in c.expected)
          expect((config as unknown as Record<string, unknown>)[key]).toEqual(
            c.expected[key],
          );
        else expect(key in config).toBe(false);
      }
    });
  }
});

describe("global tokens — config integration (V5e-2a)", () => {
  it("absent tokens ⇒ the normalised config is unchanged and the version stays 3", () => {
    const plain = normalizePresentationConfig({});
    for (const key of KEYS) expect(key in plain).toBe(false);
    expect(plain.version).toBe(3);
    expect(
      normalizePresentationConfig({
        typography: {},
        surfaces: "x",
        layout: { contentWidth: "huge" },
        motion: { duration: 5 },
      }),
    ).toEqual(plain);
  });

  it("normalisation is idempotent and leaves the legacy presets untouched", () => {
    const once = normalizePresentationConfig({
      radius: "subtle",
      density: "compact",
      surfaces: { radius: "lg", border: { width: "medium" }, shadow: "soft" },
      layout: { contentWidth: "narrow" },
      typography: { headingScale: "lg", headingWeight: 700 },
      motion: { duration: "base", easing: "standard" },
    });
    expect(once.radius).toBe("subtle");
    expect(once.density).toBe("compact");
    expect(normalizePresentationConfig(once)).toEqual(once);
  });
});

describe("resolveGlobalTokens (V5e-2a)", () => {
  it("nothing set ⇒ null (the wrapper is exactly as before)", () => {
    expect(resolveGlobalTokens(undefined)).toBeNull();
    expect(resolveGlobalTokens({})).toBeNull();
  });

  it("today's values emit nothing: md scales, hairline border, standard width, bar heading", () => {
    expect(
      resolveGlobalTokens({
        typography: { headingScale: "md", bodyScale: "md", sectionHeading: "bar" },
        surfaces: { border: { width: "hairline" } },
        layout: { contentWidth: "standard" },
      }),
    ).toBeNull();
  });

  it("typography resolves to named steps, never to pixels", () => {
    const out = resolveGlobalTokens({
      typography: {
        headingScale: "lg",
        bodyScale: "sm",
        headingWeight: 800,
        bodyWeight: 500,
        lineHeight: "relaxed",
        sectionHeading: "underline",
      },
    })!;
    expect(out.attrs["data-gt"]).toBe("hz bz hw bw lh hs-underline");
    expect(out.style).toEqual({
      "--gt-hz": "1.125",
      "--gt-bz": "0.94",
      "--gt-hw": "800",
      "--gt-bw": "500",
      "--gt-lh": "1.75",
    });
  });

  it("surfaces: radius overrides the legacy radius variables; border and shadow become tokens", () => {
    const out = resolveGlobalTokens({
      surfaces: { radius: "pill", border: { width: "medium" }, shadow: "none" },
    })!;
    expect(out.style["--store-radius"]).toBe("1.75rem");
    expect(out.style["--radius"]).toBe("1.75rem");
    expect(out.style["--gt-sbw"]).toBe("2px");
    expect(out.style["--gt-shd"]).toBe("none");
    expect(out.attrs["data-gt"]).toBe("sbw shd");
  });

  it("layout: the content width drives the one existing container variable", () => {
    expect(
      resolveGlobalTokens({ layout: { contentWidth: "narrow" } })!.style,
    ).toEqual({ "--store-content-max": "64rem" });
    expect(
      resolveGlobalTokens({ layout: { contentWidth: "wide" } })!.style,
    ).toEqual({ "--store-content-max": "100rem" });
  });

  it("motion: bounded durations and two easing curves", () => {
    const out = resolveGlobalTokens({
      motion: { duration: "slow", easing: "emphasized" },
    })!;
    expect(out.style["--gt-md"]).toBe("500ms");
    expect(out.style["--gt-me"]).toBe("cubic-bezier(0.2, 0, 0, 1)");
    expect(out.attrs["data-gt"]).toBe("mo-d mo-e");
  });

  it("no value ever carries CSS from the document (hostile input is dropped before it resolves)", () => {
    const doc = normalizeGlobalTokens({
      typography: { headingScale: "lg; background:red", lineHeight: "url(x)" },
      surfaces: { radius: "1px}body{display:none", shadow: "0 0 99px red" },
      layout: { contentWidth: "1000vw" },
      motion: { duration: "9999ms", easing: "ease" },
    });
    expect(doc).toEqual({});
    const full = resolveGlobalTokens(
      normalizeGlobalTokens({
        typography: { headingScale: "lg", headingWeight: 700, lineHeight: "tight" },
        surfaces: { radius: "md", border: { width: "none" }, shadow: "strong" },
        layout: { contentWidth: "wide" },
        motion: { duration: "fast", easing: "standard" },
      }),
    )!;
    for (const value of Object.values(full.style)) {
      expect(value).not.toMatch(/url|[{}<>]|javascript/i);
    }
  });
});
