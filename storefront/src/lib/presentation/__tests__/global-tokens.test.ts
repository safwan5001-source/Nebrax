import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizePresentationConfig } from "../config";
import {
  buttonContrastIssues,
  normalizeGlobalTokens,
  resolveGlobalTokens,
} from "../global-tokens";

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

const KEYS = ["typography", "buttons", "surfaces", "layout", "motion"] as const;

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
        typography: {
          headingScale: "md",
          bodyScale: "md",
          sectionHeading: "bar",
        },
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
        typography: {
          headingScale: "lg",
          headingWeight: 700,
          lineHeight: "tight",
        },
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

const CTX = { primaryColor: "#12372a", accentColor: null as string | null };

describe("buttons — resolver (V5e-2b)", () => {
  it("today's button emits nothing: solid · brand · darken, md size", () => {
    expect(
      resolveGlobalTokens(
        {
          buttons: {
            style: "solid",
            colour: "brand",
            hover: "darken",
            size: "md",
          },
        },
        CTX,
      ),
    ).toBeNull();
  });

  it("size / radius / text step independently of the primary colours", () => {
    const out = resolveGlobalTokens(
      {
        typography: { buttonText: { weight: 800, case: "upper" } },
        buttons: { size: "lg", radius: "pill" },
      },
      CTX,
    )!;
    expect(out.attrs["data-gt"]).toBe("b-sz b-rad b-fw b-up");
    expect(out.style["--gt-bpy"]).toBe("0.875rem");
    expect(out.style["--gt-brad"]).toBe("9999px");
    expect(out.style["--gt-bfw"]).toBe("800");
    expect("--gt-bf" in out.style).toBe(false); // the primary colours are untouched
  });

  it("solid: the label is the proven white/black over the fill — even a pale brand", () => {
    const out = resolveGlobalTokens(
      { buttons: { style: "solid", colour: "accent" } },
      { ...CTX, primaryColor: "#fde68a", accentColor: "#fde68a" },
    )!;
    expect(out.style["--gt-bf"]).toBe("#fde68a");
    expect(out.style["--gt-bl"]).toBe("#000000");
    expect(out.attrs["data-gt"]).toBe("b-pri");
  });

  it("soft: a tinted fill; the label is the role colour only when it clears 4.5:1 over the tint", () => {
    const dark = resolveGlobalTokens({ buttons: { style: "soft" } }, CTX)!;
    expect(dark.style["--gt-bl"]).toBe("#12372a");
    const pale = resolveGlobalTokens(
      { buttons: { style: "soft" } },
      { ...CTX, primaryColor: "#fde68a" },
    )!;
    expect(pale.style["--gt-bl"]).toBe("#000000"); // falls back to the proven foreground
    expect(dark.style["--gt-bf"]).not.toBe(dark.style["--gt-bl"]);
  });

  it("outline / link: transparent fill, the role colour as label, and the style token for the section override", () => {
    const outline = resolveGlobalTokens(
      { buttons: { style: "outline" } },
      CTX,
    )!;
    expect(outline.style["--gt-bf"]).toBe("transparent");
    expect(outline.style["--gt-bb"]).toBe("#12372a");
    expect(outline.attrs["data-gt"]).toBe("b-pri b-sty-outline");
    const link = resolveGlobalTokens({ buttons: { style: "link" } }, CTX)!;
    expect(link.attrs["data-gt"]).toBe("b-pri b-sty-link b-hv-underline"); // link defaults to underline
  });

  it("hover: lift and underline add their tokens; every hover label is re-proven over its hover fill", () => {
    const lift = resolveGlobalTokens({ buttons: { hover: "lift" } }, CTX)!;
    expect(lift.attrs["data-gt"]).toBe("b-pri b-hv-lift");
    expect(lift.style["--gt-bhf"]).toBe(lift.style["--gt-bf"]); // lift keeps the fill
    const darken = resolveGlobalTokens(
      { buttons: { style: "soft", hover: "darken" } },
      { ...CTX, primaryColor: "#757575" },
    )!;
    expect(darken.style["--gt-bhl"]).toMatch(/^#/);
  });

  it("without a colour context the primary colours are not guessed", () => {
    expect(resolveGlobalTokens({ buttons: { style: "soft" } })).toBeNull();
  });

  it("no value ever carries CSS from the document", () => {
    const doc = normalizeGlobalTokens({
      buttons: { style: "url(x)", colour: "#ff0000;", radius: "9px" },
      typography: { buttonText: { weight: "700; x", case: "capitalize" } },
    });
    expect(doc).toEqual({});
  });
});

describe("button contrast gate — shared fixture (V5e-2b)", () => {
  const contrast = JSON.parse(
    readFileSync(
      resolve(
        __dirname,
        "../../../../../tests/Fixtures/presentation/button-contrast.json",
      ),
      "utf8",
    ),
  ) as {
    cases: Array<{
      name: string;
      config: {
        buttons?: Record<string, string>;
        primaryColor: string;
        accentColor?: string | null;
        palette?: Record<string, string>;
      };
      expected: Array<{ field: string; code: string; ratio: number }>;
    }>;
  };
  for (const c of contrast.cases) {
    it(c.name, () => {
      const doc = normalizeGlobalTokens({ buttons: c.config.buttons });
      const issues = buttonContrastIssues(doc, {
        primaryColor: c.config.primaryColor,
        accentColor: c.config.accentColor ?? null,
        palette: c.config.palette,
      });
      expect(issues).toHaveLength(c.expected.length);
      c.expected.forEach((expected, i) => {
        expect(issues[i].field).toBe(expected.field);
        expect(issues[i].code).toBe(expected.code);
        expect(issues[i].ratio).toBeCloseTo(expected.ratio, 1);
      });
    });
  }
});
