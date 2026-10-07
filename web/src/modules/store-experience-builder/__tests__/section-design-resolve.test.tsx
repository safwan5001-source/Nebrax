/**
 * @vitest-environment jsdom
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SectionDesignFrame } from "../SectionDesignFrame";
import type { SectionDesign } from "../presentation/section-design";
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
    // groups the renderer defers (typography) produce no wrapper on their own
    expect(resolveSectionDesign("hero", { typography: { headingScale: "lg" } }, ctx)).toBeNull();
  });

  it("a solid background resolves roles to concrete colours and picks a provable foreground automatically", () => {
    const r = resolveSectionDesign("hero", { background: { kind: "solid", color: { role: "brand" } } }, ctx)!;
    expect(r.attrs).toEqual({ "data-sd": "bg fg heading", "data-design-type": "hero" });
    expect(r.style["--sec-bg"]).toBe("#12372a");
    expect(r.style["--sec-fg"]).toBe("#ffffff"); // dark brand → white
    expect(r.style["--sec-heading"]).toBe("#ffffff");
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
      "--sec-align": "center",
      "--sec-bw": "1px",
      "--sec-bc": "#e5e7eb",
    });
    expect(r.attrs["data-sd"]).toBe("align pt pb pi max border");
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
    expect(el.getAttribute("data-sd")).toBe("bg fg heading pt");
    expect(el.getAttribute("data-design-type")).toBe("benefits");
    expect(el.style.getPropertyValue("--sec-bg")).toBe("#ffffff");
    expect(el.querySelector("p")!.textContent).toBe("hi");
  });
});

describe("the Canvas and the storefront share ONE resolver (V0 §3.5)", () => {
  const web = resolve(__dirname, "../presentation");
  const storefront = resolve(__dirname, "../../../../../storefront/src/lib/presentation");
  for (const file of ["section-design-resolve.ts", "section-design.ts", "palette.ts", "contrast-engine.ts"]) {
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
    const norm = (css: string) => block(css).replace(/\.awj-store-preview /g, "").replace(/\s+/g, " ").trim();
    expect(norm(pv)).toBe(norm(sf));
  });
});
