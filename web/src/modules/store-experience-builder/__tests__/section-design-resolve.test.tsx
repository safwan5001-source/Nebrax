/**
 * @vitest-environment jsdom
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SectionDesignFrame } from "../SectionDesignFrame";
import { type SectionDesign, normalizeSectionDesign } from "../presentation/section-design";
import {
  type DesignContext,
  STEP_SPACE,
  cssGradientDirection,
  effectiveText,
  resolveSectionDesign,
  worstTextRatio,
} from "../presentation/section-design-resolve";

const ctx: DesignContext = { primaryColor: "#12372a", accentColor: null, dir: "ltr" };
const rtl: DesignContext = { ...ctx, dir: "rtl" };

afterEach(cleanup);

describe("resolveSectionDesign (CUST-HV V5c)", () => {
  it("absent or empty design ⇒ null (the caller renders the section untouched)", () => {
    expect(resolveSectionDesign("hero", undefined, ctx)).toBeNull();
    expect(resolveSectionDesign("hero", {}, ctx)).toBeNull();
    // the default steps change nothing: no wrapper
    expect(
      resolveSectionDesign("hero", { typography: { headingScale: "md", bodyScale: "md" } }, ctx),
    ).toBeNull();
  });

  it("a solid background resolves roles to concrete colours and picks a provable foreground automatically", () => {
    const r = resolveSectionDesign("hero", { background: { kind: "solid", color: { role: "brand" } } }, ctx)!;
    expect(r.attrs).toEqual({ "data-sd": "bg fg heading link", "data-design-type": "hero" });
    expect(r.style["--sec-bg"]).toBe("#12372a");
    expect(r.style["--sec-fg"]).toBe("#ffffff"); // dark brand → white
    expect(r.style["--sec-heading"]).toBe("#ffffff");
    expect(r.style["--sec-link"]).toBe("#ffffff"); // links default to the proven foreground
    const light = resolveSectionDesign("hero", { background: { kind: "solid", color: { hex: "#fff3cd" } } }, ctx)!;
    expect(light.style["--sec-fg"]).toBe("#000000");
  });

  it("explicit text with no design background is judged on the surface it really lands on", () => {
    const textOnly: SectionDesign = { text: { body: { hex: "#ffffff" } } };
    // banner paints its own white card; a shelf sits on the page background
    for (const type of ["banner", "benefits"]) {
      const text = effectiveText(textOnly, ctx, type);
      expect(text.background).toBeNull();
      expect(text.judged).not.toBeNull();
      expect(worstTextRatio("#ffffff", text)!).toBeLessThan(1.2);
      expect(worstTextRatio("#111827", text)!).toBeGreaterThan(4.5);
    }
    // nothing set ⇒ nothing to judge
    expect(effectiveText({ spacing: { top: "md" } }, ctx, "banner").judged).toBeNull();
  });

  it("a frame whose section rendered nothing collapses (no empty band)", () => {
    const { container } = render(
      <SectionDesignFrame
        section={{ type: "featured", design: { background: { kind: "solid", color: { hex: "#101820" } }, spacing: { top: "lg" } } }}
        context={ctx}
      >
        {null}
      </SectionDesignFrame>,
    );
    const frame = container.querySelector("[data-sd]") as HTMLElement;
    expect(frame).not.toBeNull();
    expect(frame.childNodes.length).toBe(0); // `:empty` ⇒ `display: none` in the stylesheet
  });

  it("typography resolves named steps to validated tokens — never a pixel input", () => {
    const r = resolveSectionDesign(
      "benefits",
      {
        typography: {
          headingScale: "xl",
          bodyScale: "lg",
          headingWeight: 700,
          lineHeight: "relaxed",
          headingStyle: "underline",
        },
      },
      ctx,
    )!;
    expect(r.attrs["data-sd"]).toBe("hs bs hw lh hstyle-underline");
    expect(r.style["--sec-hs"]).toBe("clamp(1.5rem, 4vw, 2.125rem)");
    expect(r.style["--sec-bs"]).toBe("1rem");
    expect(r.style["--sec-hw"]).toBe("700");
    expect(r.style["--sec-lh"]).toBe("1.75");
    expect(Object.values(r.style).join(" ")).not.toMatch(/url|expression|;|\{|\}/);
  });

  it("border: an explicit none is a decision (it removes a legacy border) — emitted as a zero-width transparent frame", () => {
    const r = resolveSectionDesign("banner", { border: { width: "none" } }, ctx)!;
    expect(r.attrs["data-sd"]).toBe("border");
    expect(r.style["--sec-bw"]).toBe("0px");
    expect(r.style["--sec-bc"]).toBe("transparent");
  });

  it("a section that paints its own dark surface ignores text colours until the design paints a background", () => {
    const textOnly: SectionDesign = { text: { body: { hex: "#ffffff" } } };
    for (const type of ["hero", "appPromo", "wholesale"]) {
      expect(resolveSectionDesign(type, textOnly, ctx)).toBeNull();
    }
    // a light-surface section keeps it (judged against the page background)
    expect(resolveSectionDesign("banner", textOnly, ctx)!.style["--sec-fg"]).toBe("#ffffff");
    // with a design background the colours apply again
    const withBg: SectionDesign = { ...textOnly, background: { kind: "solid", color: { hex: "#101820" } } };
    expect(resolveSectionDesign("hero", withBg, ctx)!.style["--sec-fg"]).toBe("#ffffff");
  });

  it("explicit text colours win over the automatic foreground; link only when asked", () => {
    const r = resolveSectionDesign(
      "banner",
      {
        background: { kind: "solid", color: { hex: "#101820" } },
        text: { body: { hex: "#e5e7eb" }, heading: { hex: "#ffffff" }, link: { role: "accent" } },
      },
      ctx,
    )!;
    expect(r.style["--sec-fg"]).toBe("#e5e7eb");
    expect(r.style["--sec-heading"]).toBe("#ffffff");
    expect(r.style["--sec-link"]).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("gradient directions are logical and mirror under RTL", () => {
    expect(cssGradientDirection("to-end", "ltr")).toBe("to right");
    expect(cssGradientDirection("to-end", "rtl")).toBe("to left");
    expect(cssGradientDirection("to-bottom-start", "ltr")).toBe("to bottom left");
    expect(cssGradientDirection("to-bottom-start", "rtl")).toBe("to bottom right");
    expect(cssGradientDirection("to-top", "rtl")).toBe("to top");
    const design: SectionDesign = { background: { kind: "gradient", from: { role: "brand" }, to: { hex: "#1c2a6b" }, direction: "to-end" } };
    expect(resolveSectionDesign("hero", design, ctx)!.style["--sec-bg"]).toBe("linear-gradient(to right, #12372a, #1c2a6b)");
    expect(resolveSectionDesign("hero", design, rtl)!.style["--sec-bg"]).toBe("linear-gradient(to left, #12372a, #1c2a6b)");
  });

  it("a gradient's foreground is judged against the WHOLE range, not its ends", () => {
    // the documented counter-example: both stops pass for black text, the interior does not.
    const text = effectiveText({ background: { kind: "gradient", from: { hex: "#d1456a" }, to: { hex: "#1e8b9a" }, direction: "to-end" } }, ctx);
    const black = worstTextRatio("#000000", text)!;
    const white = worstTextRatio("#ffffff", text)!;
    expect(black).toBeLessThan(4.5);
    // neither neutral is provable here: the resolver still picks the better one, and the
    // V5d publish gate (which asks the same question) will block this pair — V0 §4.5.5.
    expect(white).toBeLessThan(4.5);
    expect(text.body).toBe(black >= white ? "#000000" : "#ffffff");
    expect(worstTextRatio(text.body!, text)!).toBe(Math.max(black, white));
  });

  it("a SOLID background always has a provable automatic foreground (no colour is rejected)", () => {
    for (const hex of ["#777777", "#808080", "#d1456a", "#1e8b9a", "#ffd166", "#06d6a0", "#101820", "#f5f5f5"]) {
      const text = effectiveText({ background: { kind: "solid", color: { hex } } }, ctx);
      expect(worstTextRatio(text.body!, text)!).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("palette roles resolve through the merchant's palette, then today's fixed tokens", () => {
    const withPalette: DesignContext = { ...ctx, palette: { surfaceAlt: "#eef2ff" } };
    const design: SectionDesign = { background: { kind: "solid", color: { role: "surfaceAlt" } } };
    expect(resolveSectionDesign("hero", design, withPalette)!.style["--sec-bg"]).toBe("#eef2ff");
    expect(resolveSectionDesign("hero", design, ctx)!.style["--sec-bg"]).toBe("#f3f4f6"); // today's token
  });

  it("spacing, width.max, align, border map to validated tokens only", () => {
    const r = resolveSectionDesign(
      "customContent",
      {
        spacing: { top: "lg", bottom: "none", inner: "sm" },
        width: { max: "narrow" },
        align: "center",
        border: { width: "hairline" },
      },
      ctx,
    )!;
    expect(r.style).toEqual({
      "--sec-pt": STEP_SPACE.lg,
      "--sec-pb": "0px",
      "--sec-pi": STEP_SPACE.sm,
      "--sec-max": "64rem",
      "--sec-bms": "auto",
      "--sec-bme": "auto",
      "--sec-bw": "1px",
      "--sec-bc": "#e5e7eb",
    });
    expect(r.attrs["data-sd"]).toBe("balign pt pb pi max border");
  });

  it("text alignment and content-block alignment are independent controls", () => {
    const both = resolveSectionDesign(
      "customContent",
      { align: "center", text: { align: "start" } },
      ctx,
    )!;
    expect(both.attrs["data-sd"]).toBe("align balign");
    expect(both.style["--sec-align"]).toBe("start"); // the copy
    expect(both.style["--sec-bms"]).toBe("auto"); // the block is centred
    expect(both.style["--sec-bme"]).toBe("auto");
    const end = resolveSectionDesign("customContent", { align: "end" }, ctx)!;
    expect(end.style).toEqual({ "--sec-bms": "auto", "--sec-bme": "0" });
    expect(end.attrs["data-sd"]).toBe("balign");
  });

  it("full-bleed is a solid band: it drops radius/shadow, and a gradient never bleeds", () => {
    const solid = resolveSectionDesign(
      "hero",
      { background: { kind: "solid", color: { hex: "#101820" } }, width: { mode: "full" }, radius: "lg", shadow: "strong" },
      ctx,
    )!;
    expect(solid.attrs["data-sd"]).toContain("bleed");
    expect(solid.attrs["data-sd"]).not.toContain("radius");
    expect(solid.attrs["data-sd"]).not.toContain("shadow");
    expect(solid.style["--sec-bleed"]).toBe("0 0 0 100vmax #101820");
    const grad = resolveSectionDesign(
      "hero",
      { background: { kind: "gradient", from: { hex: "#101820" }, to: { hex: "#223344" }, direction: "to-end" }, width: { mode: "full" }, radius: "lg" },
      ctx,
    )!;
    expect(grad.attrs["data-sd"]).not.toContain("bleed");
    expect(grad.attrs["data-sd"]).toContain("radius");
  });

  it("emits only data-sd / data-design-type and --sec-* variables, with values from a fixed alphabet", () => {
    const r = resolveSectionDesign(
      "hero",
      {
        background: { kind: "gradient", from: { role: "brand" }, to: { role: "accent" }, direction: "to-bottom-end" },
        text: { align: "end", link: { role: "link" } },
        spacing: { top: "xl", bottom: "md", inner: "xs" },
        width: { max: "wide", mode: "full" },
        border: { width: "medium", color: { role: "brand" } },
        radius: "pill",
        shadow: "medium",
      },
      ctx,
    )!;
    expect(Object.keys(r.attrs).sort()).toEqual(["data-design-type", "data-sd"]);
    for (const [k, v] of Object.entries(r.style)) {
      expect(k).toMatch(/^--sec-[a-z]+$/);
      expect(v).toMatch(/^[#a-z0-9 .,()%-]+$/i);
      expect(v).not.toMatch(/url|expression|javascript|;|\{|\}/i);
    }
  });
});

describe("SectionDesignFrame (CUST-HV V5c)", () => {
  it("no design ⇒ exactly the children, no wrapper, no attribute", () => {
    const { container } = render(
      <SectionDesignFrame section={{ type: "hero" }} context={ctx}>
        <p id="x">hello</p>
      </SectionDesignFrame>,
    );
    expect(container.innerHTML).toBe('<p id="x">hello</p>');
  });

  it("a design ⇒ one wrapper carrying the resolver's attributes and variables", () => {
    const { container } = render(
      <SectionDesignFrame
        section={{ type: "benefits", design: { background: { kind: "solid", color: { role: "surface" } }, spacing: { top: "md" } } }}
        context={ctx}
      >
        <p>hi</p>
      </SectionDesignFrame>,
    );
    const el = container.firstElementChild as HTMLElement;
    expect(el.getAttribute("data-sd")).toBe("bg fg heading link pt");
    expect(el.getAttribute("data-design-type")).toBe("benefits");
    expect(el.style.getPropertyValue("--sec-bg")).toBe("#ffffff");
    expect(el.querySelector("p")!.textContent).toBe("hi");
  });
});

describe("the Canvas and the storefront share ONE resolver (V0 §3.5)", () => {
  const web = resolve(__dirname, "../presentation");
  const storefront = resolve(__dirname, "../../../../../storefront/src/lib/presentation");
  for (const file of ["section-design-resolve.ts", "section-design.ts", "palette.ts", "contrast-engine.ts", "global-tokens.ts", "font-catalogue.ts", "cta-colour.ts"]) {
    it(`${file} is byte-identical in web and storefront`, () => {
      expect(readFileSync(resolve(web, file), "utf8")).toBe(readFileSync(resolve(storefront, file), "utf8"));
    });
  }

  it("the section-design CSS block is the same rule set in both stylesheets (modulo the preview scope)", () => {
    const sf = readFileSync(resolve(__dirname, "../../../../../storefront/src/app/globals.css"), "utf8");
    const pv = readFileSync(resolve(__dirname, "../store-preview.css"), "utf8");
    expect(sf).toContain("[data-sd]:empty");
    expect(pv).toContain("[data-sd]:empty");
    const block = (css: string) => css.slice(css.indexOf("CUST-HV V5c — section design"));
    const norm = (css: string) => block(css).replace(/\.awj-store-preview(?=\[)/g, "").replace(/\.awj-store-preview /g, "").replace(/\s+/g, " ").trim();
    // the storefront block sits inside `@layer utilities { … }` (same layer as Tailwind's utilities)
    expect(sf).toMatch(/@layer utilities \{\s*\/\*\s*\* CUST-HV V5c — section design/);
    expect(norm(pv)).toBe(norm(sf).replace(/\}$/, "").trim());
  });
});

describe("surface matcher in the stylesheet (CUST-HV V5c review)", () => {
  it("treats class tokens that start with `bg-store-*` / `bg-white` as surfaces — never variants like hover:bg-store-*", () => {
    const css = readFileSync(resolve(__dirname, "../store-preview.css"), "utf8");
    const rule = css.match(/:where\([^\n]*?\[data-sd~="fg"\] (:is\([^{]*?\)):not\(\[data-sd\] > \*\)\)/);
    expect(rule, "the nested-surface reset rule").not.toBeNull();
    const selector = rule![1];
    const probe = (className: string) => {
      const el = document.createElement("div");
      el.className = className;
      return el.matches(selector);
    };
    expect(probe("bg-store-surface p-4")).toBe(true);
    expect(probe("p-2 bg-store-footer text-xs")).toBe(true);
    expect(probe("rounded bg-white")).toBe(true);
    // translucent fills are surfaces too (made opaque inside a designed section)
    expect(probe("bg-white/80")).toBe(true);
    expect(probe("bg-store-surface/90")).toBe(true);
    expect(probe("bg-store-footer-border/40")).toBe(true);
    // variants are not
    expect(probe("bg-transparent hover:bg-store-footer-border")).toBe(false);
    expect(probe("hover:bg-white/10 px-2")).toBe(false);
  });
});

describe("resolveSectionDesign — picture backgrounds (CUST-HV V6b-3)", () => {
  const A = "0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d5e";
  const dark = { min: [0, 0, 0], max: [40, 50, 60] } as const;
  const wide = { min: [0, 0, 0], max: [255, 255, 255] } as const;
  const withBounds = (bounds: typeof dark | typeof wide | null): DesignContext => ({
    ...ctx,
    mediaBounds: () => (bounds ? { min: bounds.min, max: bounds.max } : null),
  });
  const picture = (overlay?: { alpha: number }): SectionDesign => ({
    background: {
      kind: "media",
      media: { mediaId: A, decorative: true },
      ...(overlay
        ? { overlay: { color: { hex: "#000000" }, alpha: overlay.alpha as 40 } }
        : {}),
    },
  });

  it("a proven picture sets the picture tokens, the overlay vars and a proven automatic foreground — never the solid-fill token", () => {
    const r = resolveSectionDesign("hero", picture({ alpha: 40 }), withBounds(dark));
    const tokens = r?.attrs["data-sd"].split(" ") ?? [];
    expect(tokens).toEqual(expect.arrayContaining(["mbg", "ovl", "fg"]));
    expect(tokens).not.toContain("bg");
    expect(r?.style["--sec-ovl"]).toBe("#000000");
    expect(r?.style["--sec-ovl-a"]).toBe("0.4");
    expect(r?.style["--sec-bg"]).toBeUndefined();
    expect(r?.style["--sec-fg"]).toBe("#ffffff");
  });

  it("an overlay-less picture has no overlay vars", () => {
    const r = resolveSectionDesign("hero", picture(), withBounds(dark));
    expect(r?.attrs["data-sd"]).toContain("mbg");
    expect(r?.attrs["data-sd"]).not.toContain("ovl");
    expect(r?.style["--sec-ovl-a"]).toBeUndefined();
  });

  it("no bounds, no evidence-backed range, or a range the text cannot clear ⇒ nothing is painted and no foreground is chosen", () => {
    for (const c of [ctx, withBounds(null), withBounds(wide)]) {
      const r = resolveSectionDesign("hero", picture(), c);
      expect(r?.attrs["data-sd"] ?? "").not.toContain("mbg");
      expect(r?.style["--sec-fg"]).toBeUndefined();
    }
  });

  it("the overlay is what makes a wide-range picture provable", () => {
    const r = resolveSectionDesign("hero", picture({ alpha: 80 }), withBounds(wide));
    expect(r?.attrs["data-sd"]).toContain("mbg");
  });
});

describe("resolveSectionDesign — placement and height (CUST-HV V6c-3)", () => {
  it("valign sets the block-axis token (start = top, end = bottom) beside the inline half", () => {
    const r = resolveSectionDesign("hero", { align: "end", valign: "end" }, ctx)!;
    expect(r.style).toEqual({ "--sec-bms": "auto", "--sec-bme": "0", "--sec-vj": "flex-end" });
    expect(r.attrs["data-sd"]).toBe("balign valign");
    expect(resolveSectionDesign("banner", { valign: "start" }, ctx)!.style["--sec-vj"]).toBe("flex-start");
    expect(resolveSectionDesign("banner", { valign: "center" }, ctx)!.style["--sec-vj"]).toBe("center");
  });

  it("each height preset resolves to a bounded minimum; only `screen` follows the viewport, clamped", () => {
    const values = (["compact", "standard", "tall", "screen"] as const).map(
      (height) => resolveSectionDesign("hero", { mediaTreatment: { height } }, ctx)!.style["--sec-minh"],
    );
    expect(values).toEqual(["10rem", "18rem", "28rem", "clamp(24rem, 100svh, 56rem)"]);
    const r = resolveSectionDesign("banner", { mediaTreatment: { height: "tall" } }, ctx)!;
    expect(r.attrs["data-sd"]).toBe("hgt");
    expect(Object.keys(r.style)).toEqual(["--sec-minh"]); // a height emits no raw CSS besides its token
  });

  it("`screen` follows the simulated device when the context says so (the Canvas), else the real viewport", () => {
    const canvas = resolveSectionDesign("hero", { mediaTreatment: { height: "screen" } }, { ...ctx, screenHeightPx: 844 })!;
    expect(canvas.style["--sec-minh"]).toBe("clamp(24rem, 844px, 56rem)");
    expect(resolveSectionDesign("hero", { mediaTreatment: { height: "screen" } }, ctx)!.style["--sec-minh"]).toBe(
      "clamp(24rem, 100svh, 56rem)",
    );
    // other presets ignore it
    expect(
      resolveSectionDesign("hero", { mediaTreatment: { height: "tall" } }, { ...ctx, screenHeightPx: 844 })!.style["--sec-minh"],
    ).toBe("28rem");
  });

  it("only hero and banner carry them: the contract drops them elsewhere, so nothing resolves", () => {
    for (const type of ["benefits", "customContent", "appPromo", "categories", "featured"]) {
      const normalised = normalizeSectionDesign(type, { valign: "end", mediaTreatment: { height: "tall" } });
      expect(normalised).toBeUndefined();
      expect(resolveSectionDesign(type, normalised, ctx)).toBeNull();
    }
  });

  it("an absent valign / height leaves the resolved output exactly as it was", () => {
    const before = resolveSectionDesign("hero", { align: "center" }, ctx)!;
    expect(before.attrs["data-sd"]).toBe("balign");
    expect(Object.keys(before.style)).toEqual(["--sec-bms", "--sec-bme"]);
  });

  it("the stylesheet owns the layout: a height replaces the section minimum, the root becomes a column flex box", () => {
    const sf = readFileSync(resolve(__dirname, "../../../../../storefront/src/app/globals.css"), "utf8");
    expect(sf).toContain('[data-sd~="hgt"][data-sd] > * {');
    expect(sf).toMatch(/min-block-size:\s*var\(--sec-minh\)/);
    expect(sf).toMatch(/\[data-sd~="valign"\]\)\[data-sd\] > \* \{\s*display:\s*flex;\s*flex-direction:\s*column;[^}]*justify-content:\s*var\(--sec-vj, center\)/);
    // with a height but no explicit position: a hero stays centred, a banner stays at the top (what each always did)
    expect(sf).toMatch(
      /\[data-design-type="banner"\]:is\(\[data-sd~="hgt"\], \[data-sd~="valign"\]\) > \* \{\s*justify-content:\s*var\(--sec-vj, flex-start\)/,
    );
  });
});

describe("resolveSectionDesign — hero overlap (CUST-HV V6c-4)", () => {
  const A = "0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d5e";
  const dark = { min: [0, 0, 0] as [number, number, number], max: [40, 50, 60] as [number, number, number] };
  const wide = { min: [0, 0, 0] as [number, number, number], max: [255, 255, 255] as [number, number, number] };
  const withBounds = (bounds: typeof dark | null, extra: Partial<DesignContext> = {}): DesignContext => ({
    ...ctx,
    ...extra,
    mediaBounds: () => (bounds ? { min: bounds.min, max: bounds.max } : null),
  });
  const heroDesign = (extra: Partial<SectionDesign> = {}): SectionDesign => ({
    background: { kind: "media", media: { mediaId: A, decorative: true }, overlay: { color: { hex: "#000000" }, alpha: 40 } },
    overlap: "md",
    ...extra,
  });

  it("a proven picture hero emits the preset token (sm 2rem, md 4rem) and the `ovlp` marker", () => {
    const md = resolveSectionDesign("hero", heroDesign(), withBounds(dark))!;
    expect(md.style["--sec-ovlp"]).toBe("4rem");
    expect(md.attrs["data-sd"]).toContain("ovlp");
    const sm = resolveSectionDesign("hero", heroDesign({ overlap: "sm" }), withBounds(dark))!;
    expect(sm.style["--sec-ovlp"]).toBe("2rem");
  });

  it("is disabled automatically when the hero is not a media hero that really paints", () => {
    // solid / gradient background, no background, an unprovable picture, a picture with no evidence
    for (const design of [
      { overlap: "md" as const, background: { kind: "solid" as const, color: { hex: "#101820" } } },
      { overlap: "md" as const, radius: "lg" as const },
    ]) {
      const r = resolveSectionDesign("hero", design, withBounds(dark));
      expect(r?.attrs["data-sd"] ?? "").not.toContain("ovlp");
      expect(r?.style["--sec-ovlp"]).toBeUndefined();
    }
    const unprovable = resolveSectionDesign("hero", heroDesign(), withBounds(wide, {}));
    expect(unprovable?.attrs["data-sd"] ?? "").not.toContain("ovlp");
    const noEvidence = resolveSectionDesign("hero", heroDesign(), withBounds(null));
    expect(noEvidence?.attrs["data-sd"] ?? "").not.toContain("ovlp");
  });

  it("a bottom separator disables it (the next section would cover the edge); a top one does not", () => {
    const bottom = resolveSectionDesign("hero", heroDesign({ separator: { bottom: "wave" } }), withBounds(dark))!;
    expect(bottom.attrs["data-sd"]).not.toContain("ovlp");
    const top = resolveSectionDesign("hero", heroDesign({ separator: { top: "wave" } }), withBounds(dark))!;
    expect(top.attrs["data-sd"]).toContain("ovlp");
    const none = resolveSectionDesign("hero", heroDesign({ separator: { bottom: "none" } }), withBounds(dark))!;
    expect(none.attrs["data-sd"]).toContain("ovlp");
  });

  it("a simulated phone (Canvas) gets none; a simulated tablet or desktop gets it", () => {
    expect(resolveSectionDesign("hero", heroDesign(), withBounds(dark, { simulatedWidthPx: 390 }))!.attrs["data-sd"]).not.toContain("ovlp");
    expect(resolveSectionDesign("hero", heroDesign(), withBounds(dark, { simulatedWidthPx: 767 }))!.attrs["data-sd"]).not.toContain("ovlp");
    expect(resolveSectionDesign("hero", heroDesign(), withBounds(dark, { simulatedWidthPx: 768 }))!.attrs["data-sd"]).toContain("ovlp");
    expect(resolveSectionDesign("hero", heroDesign(), withBounds(dark, { simulatedWidthPx: 1280 }))!.attrs["data-sd"]).toContain("ovlp");
  });

  it("hero only: a banner never overlaps, even with a hand-built design", () => {
    const banner = resolveSectionDesign("banner", heroDesign(), withBounds(dark))!;
    expect(banner.attrs["data-sd"]).not.toContain("ovlp");
  });

  it("the stylesheet: ≥ md only, the hero reserves the amount, the next section is an opaque sheet that yields to its own surface", () => {
    const sf = readFileSync(resolve(__dirname, "../../../../../storefront/src/app/globals.css"), "utf8");
    const at = sf.indexOf("V6c-4 (V0 §6.5, D-13)");
    expect(at).toBeGreaterThan(0);
    const block = sf.slice(at, sf.indexOf("\n}\n", at) + 3);
    expect(block).toContain("@media (min-width: 48rem) {");
    expect(block).toMatch(/\[data-sd~="ovlp"\]\[data-sd\]:has\(\+ :not\(:empty\)\) \{\s*padding-block-end: 0;\s*margin-block-end: calc\(-1 \* var\(--sec-ovlp\)\);/);
    expect(block).toMatch(/\[data-sd~="ovlp"\]\[data-sd\]:has\(\+ :not\(:empty\)\) > \* \{\s*padding-block-end: calc\(var\(--sec-pi, 0px\) \+ var\(--sec-ovlp\)\);/);
    expect(block).toMatch(/\[data-sd~="ovlp"\]\[data-sd\] \+ :not\(:empty\) \{[^}]*position: relative;\s*z-index: 2;/);
    // a height preset stays the hero's VISIBLE height: its minimum grows by the overlap the sheet covers
    expect(block).toMatch(
      /\[data-sd~="ovlp"\]\[data-sd~="hgt"\]\[data-sd\]:has\(\+ :not\(:empty\)\) > \* \{\s*min-block-size: calc\(var\(--sec-minh\) \+ var\(--sec-ovlp\)\);/,
    );
    // zero specificity: a designed background / radius / surface class on the next section always wins
    expect(block).toMatch(/:where\(\[data-sd~="ovlp"\]\[data-sd\] \+ :not\(:empty\)\) \{\s*background-color: var\(--store-background\);/);
  });
});
