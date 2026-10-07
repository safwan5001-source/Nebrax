import { describe, expect, it } from "vitest";
import type { SectionDesign } from "../section-design";
import {
  type DesignContext,
  resolveSectionDesign,
} from "../section-design-resolve";

const ctx: DesignContext = {
  primaryColor: "#12372a",
  accentColor: null,
  dir: "ltr",
};
const resolve = (design: SectionDesign, dir: "ltr" | "rtl" = "ltr") =>
  resolveSectionDesign("benefits", design, { ...ctx, dir })!;

const decode = (layer: string) => {
  const m = layer.match(/url\("data:image\/svg\+xml,([^"]+)"\)/);
  return m ? decodeURIComponent(m[1]) : null;
};

describe("separators — resolver (V5e-3)", () => {
  it("none / absent emit nothing", () => {
    expect(resolveSectionDesign("benefits", { separator: {} }, ctx)).toBeNull();
    expect(
      resolveSectionDesign(
        "benefits",
        { separator: { top: "none", bottom: "none", height: "lg" } },
        ctx,
      ),
    ).toBeNull();
  });

  it("a line is a one-pixel gradient layer on the edge and reserves its thickness", () => {
    const out = resolve({ separator: { bottom: "line", height: "md" } });
    expect(out.attrs["data-sd"]).toBe("sep sepb");
    expect(out.style["--sec-sep"]).toBe(
      "linear-gradient(#e5e7eb, #e5e7eb) bottom / 100% 2px no-repeat",
    );
    expect(out.style["--sec-sepb"]).toBe("2px");
    expect("--sec-sept" in out.style).toBe(false);
  });

  it("a band defaults to the brand colour; an explicit colour wins (role or hex)", () => {
    expect(
      resolve({ separator: { top: "band" } }).style["--sec-sep"],
    ).toContain("#12372a");
    expect(
      resolve({ separator: { top: "band", color: { hex: "#fde68a" } } }).style[
        "--sec-sep"
      ],
    ).toContain("#fde68a");
    expect(
      resolve({ separator: { top: "line", color: { role: "text" } } }).style[
        "--sec-sep"
      ],
    ).toContain("#111827");
  });

  it("a shape is an inline SVG built from validated tokens, with the edge height reserved", () => {
    const out = resolve({ separator: { bottom: "wave", height: "lg" } });
    const layer = out.style["--sec-sep"];
    expect(layer).toMatch(/bottom \/ 100% 4rem no-repeat$/);
    const svg = decode(layer)!;
    // no designed background: a page-coloured shape would be invisible, so it defaults to the brand
    expect(svg).toContain("fill='#12372a'");
    expect(svg).toContain("preserveAspectRatio='none'");
    expect(svg).not.toContain("transform"); // bottom edge, LTR: neither flipped nor mirrored
    expect(out.style["--sec-sepb"]).toBe("4rem");
  });

  it("on a designed background a shape defaults to the page behind it; an explicit colour still wins (review)", () => {
    const withBg = resolve({
      background: { kind: "solid", color: { hex: "#101820" } },
      separator: { bottom: "wave" },
    });
    expect(decode(withBg.style["--sec-bg"])!).toContain("fill='#f8f9fa'");
    const explicit = resolve({ separator: { bottom: "wave", color: { hex: "#fde68a" } } });
    expect(decode(explicit.style["--sec-sep"])!).toContain("fill='#fde68a'");
  });

  it("a top edge flips the shape vertically; RTL mirrors it horizontally", () => {
    const top = decode(
      resolve({ separator: { top: "curve" } }).style["--sec-sep"],
    )!;
    expect(top).toContain("translate(0 100) scale(1 -1)");
    expect(top).not.toContain("scale(-1 1)");
    const rtl = decode(
      resolve({ separator: { bottom: "angle" } }, "rtl").style["--sec-sep"],
    )!;
    expect(rtl).toContain("translate(1200 0) scale(-1 1)");
    const both = decode(
      resolve({ separator: { top: "wave" } }, "rtl").style["--sec-sep"],
    )!;
    expect(both).toContain(
      "translate(0 100) scale(1 -1) translate(1200 0) scale(-1 1)",
    );
  });

  it("top and bottom edges layer together, each reserving its own height", () => {
    const out = resolve({
      separator: { top: "line", bottom: "curve", height: "sm" },
    });
    expect(out.attrs["data-sd"]).toBe("sep sept sepb");
    expect(out.style["--sec-sept"]).toBe("1px");
    expect(out.style["--sec-sepb"]).toBe("1.5rem");
    expect(
      out.style["--sec-sep"].split(/, (?=linear-gradient|url)/),
    ).toHaveLength(2);
  });

  it("with a background the layers are prepended to it (one background property)", () => {
    const out = resolve({
      background: { kind: "solid", color: { hex: "#101820" } },
      separator: { bottom: "wave" },
    });
    expect(out.style["--sec-bg"]).toMatch(
      /^url\("data:image\/svg\+xml,.*#101820$/,
    );
    expect("--sec-sep" in out.style).toBe(false);
    const gradient = resolve({
      background: {
        kind: "gradient",
        from: { hex: "#101820" },
        to: { hex: "#1c2a6b" },
        direction: "to-end",
      },
      separator: { top: "band" },
    });
    expect(gradient.style["--sec-bg"]).toMatch(
      /linear-gradient\(to right, #101820, #1c2a6b\)$/,
    );
  });

  it("a full-bleed band has no shape edges", () => {
    const out = resolve({
      background: { kind: "solid", color: { hex: "#101820" } },
      width: { mode: "full" },
      separator: { bottom: "wave" },
    });
    expect(out.attrs["data-sd"]).not.toContain("sep");
    expect(out.style["--sec-bg"]).toBe("#101820");
  });

  it("only validated tokens ever reach the CSS: an encoded data URI and plain colours", () => {
    const out = resolve({
      separator: { top: "wave", bottom: "line", color: { hex: "#abcdef" } },
    });
    for (const layer of out.style["--sec-sep"].split(
      /, (?=linear-gradient|url)/,
    )) {
      if (layer.startsWith("url(")) {
        expect(layer).toMatch(
          /^url\("data:image\/svg\+xml,[A-Za-z0-9%._~!*'()-]+"\) (top|bottom) \/ 100% [0-9.]+rem no-repeat$/,
        );
      } else {
        expect(layer).toMatch(
          /^linear-gradient\(#[0-9a-f]{6}, #[0-9a-f]{6}\) (top|bottom) \/ 100% [0-9.]+(px|rem) no-repeat$/,
        );
      }
    }
  });

  it("the reveal is only an attribute; none emits nothing", () => {
    expect(
      resolveSectionDesign("banner", { motion: { reveal: "fade-up" } }, ctx)!
        .attrs["data-sd"],
    ).toBe("reveal");
    expect(
      resolveSectionDesign("banner", { motion: { reveal: "none" } }, ctx),
    ).toBeNull();
  });
});
