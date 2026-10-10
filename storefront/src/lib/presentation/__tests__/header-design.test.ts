import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizePresentationConfig } from "../config";
import {
  headerContrastIssues,
  headerDesktopLayout,
  headerIsCompact,
  normalizeHeaderDesign,
  resolveHeaderDesign,
  SCROLL_UP_JITTER_PX,
  stepScrollUp,
} from "../header-design";

const fixture = JSON.parse(
  readFileSync(
    resolve(
      __dirname,
      "../../../../../tests/Fixtures/presentation/header-design.json",
    ),
    "utf8",
  ),
) as {
  cases: Array<{ name: string; input: unknown; expected: unknown }>;
};

describe("header design — shared fixture (V7a)", () => {
  for (const c of fixture.cases) {
    it(c.name, () => {
      const out = normalizeHeaderDesign(c.input);
      expect(out ?? null).toEqual(c.expected);
      if (c.expected) {
        expect(Object.keys(out as object)).toEqual(
          Object.keys(c.expected as object),
        );
      }
      const config = normalizePresentationConfig({
        header: { design: c.input },
      });
      if (c.expected === null) expect("design" in config.header).toBe(false);
      else expect(config.header.design).toEqual(c.expected);
    });
  }
});

describe("header design — config integration (V7a)", () => {
  it("absent design ⇒ the header is unchanged and the version stays 3", () => {
    const plain = normalizePresentationConfig({});
    expect("design" in plain.header).toBe(false);
    expect(plain.version).toBe(3);
    expect(
      normalizePresentationConfig({
        header: { design: { layout: "mega", sticky: "hover" } },
      }),
    ).toEqual(plain);
  });

  it("rides beside the legacy header fields and is idempotent", () => {
    const once = normalizePresentationConfig({
      header: {
        style: "compact",
        showSearch: false,
        design: { layout: "centered" },
      },
    });
    expect(once.header.style).toBe("compact");
    expect(once.header.showSearch).toBe(false);
    expect(Object.keys(once.header)).toEqual([
      "style",
      "showSearch",
      "showAccount",
      "showCart",
      "showCategoryNav",
      "links",
      "design",
    ]);
    expect(normalizePresentationConfig(once)).toEqual(once);
  });
});

describe("header design — resolution (V7a)", () => {
  it("absent design resolves to the existing rendering: no tokens, standard structure", () => {
    const r = resolveHeaderDesign(undefined);
    expect(r.attrs).toBeUndefined();
    expect(r).toMatchObject({
      layout: "standard",
      mobileLayout: "logo-centre",
      sticky: "always",
      designed: false,
    });
    expect(r.logoSize).toBeUndefined();
  });

  it("defaults emit no token (they are the rendering that already exists)", () => {
    const r = resolveHeaderDesign({
      layout: "standard",
      mobileLayout: "logo-centre",
      height: "standard",
      sticky: "always",
      border: { width: "hairline" },
      shadow: "none",
    });
    expect(r.attrs).toBeUndefined();
    expect(r.designed).toBe(true);
  });

  it("every non-default choice maps to one stable token", () => {
    expect(
      resolveHeaderDesign({
        layout: "two-row",
        height: "tall",
        sticky: "off",
        border: { width: "medium" },
        shadow: "medium",
      }).attrs,
    ).toEqual({ "data-hd": "hh-t hl-2 hs-o hb-m hx-m" });
    expect(
      resolveHeaderDesign({
        height: "compact",
        border: { width: "none" },
        shadow: "soft",
      }).attrs,
    ).toEqual({ "data-hd": "hh-c hb-n hx-s" });
  });

  it("compact is a logo/utility-strip choice and renders the standard row", () => {
    expect(headerDesktopLayout({ layout: "compact" })).toBe("standard");
    expect(headerDesktopLayout({ layout: "centered" })).toBe("centered");
    expect(headerDesktopLayout(undefined)).toBe("standard");
  });

  it("design.layout wins over the legacy style; absent layout defers to it", () => {
    expect(headerIsCompact({ style: "compact" })).toBe(true);
    expect(headerIsCompact({ style: "standard" })).toBe(false);
    expect(headerIsCompact({ style: "compact", design: {} })).toBe(true);
    expect(
      headerIsCompact({ style: "compact", design: { layout: "standard" } }),
    ).toBe(false);
    expect(
      headerIsCompact({ style: "standard", design: { layout: "compact" } }),
    ).toBe(true);
  });
});

const contrastFixture = JSON.parse(
  readFileSync(
    resolve(
      __dirname,
      "../../../../../tests/Fixtures/presentation/header-contrast.json",
    ),
    "utf8",
  ),
) as {
  cases: Array<{
    name: string;
    config: {
      primaryColor: string;
      accentColor?: string | null;
      palette?: Record<string, string>;
      design: unknown;
    };
    expected: Array<{ field: string; code: string; ratio: number }>;
  }>;
};

describe("header contrast gate — shared fixture (V7b)", () => {
  for (const c of contrastFixture.cases) {
    it(c.name, () => {
      const design = normalizeHeaderDesign(c.config.design);
      const issues = headerContrastIssues(design, {
        primaryColor: c.config.primaryColor,
        accentColor: c.config.accentColor ?? null,
        palette: c.config.palette,
      });
      expect(issues.map((i) => [i.field, i.code])).toEqual(
        c.expected.map((e) => [e.field, e.code]),
      );
      issues.forEach((issue, index) => {
        expect(issue.ratio).toBeCloseTo(c.expected[index].ratio, 1);
      });
    });
  }
});

describe("header colours — resolution (V7b)", () => {
  const ctx = { primaryColor: "#12372a", accentColor: null };

  it("without a colour context or colour fields nothing colour-related is emitted", () => {
    expect(
      resolveHeaderDesign({ layout: "centered" }, ctx).style,
    ).toBeUndefined();
    expect(
      resolveHeaderDesign({ surface: { background: { hex: "#000000" } } })
        .style,
    ).toBeUndefined();
    expect(resolveHeaderDesign({ layout: "centered" }, ctx).coloured).toBe(
      false,
    );
  });

  it("a designed background brings the proven automatic text colour", () => {
    const dark = resolveHeaderDesign(
      { surface: { background: { hex: "#12372a" } } },
      ctx,
    );
    expect(dark.attrs).toEqual({ "data-hd": "hbg htx" });
    expect(dark.style?.["--hd-bg"]).toBe("#12372a");
    expect(dark.style?.["--hd-fg"]).toBe("#ffffff");
    expect(dark.coloured).toBe(true);
    const pale = resolveHeaderDesign(
      { surface: { background: { hex: "#fde68a" } } },
      ctx,
    );
    expect(pale.style?.["--hd-fg"]).toBe("#000000");
  });

  it("the automatic colour clears 4.5:1 on every solid background (by construction)", () => {
    for (let v = 0; v <= 255; v += 5) {
      const hex = `#${[v, (v * 3) % 256, (v * 7) % 256].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
      const r = resolveHeaderDesign({ surface: { background: { hex } } }, ctx);
      expect(
        headerContrastIssues(
          {
            surface: { background: { hex } },
            text: { hex: r.style?.["--hd-fg"] as string },
          },
          ctx,
        ),
      ).toEqual([]);
    }
  });

  it("an explicit text wins; secondary text only softens when it still clears 4.5:1", () => {
    const r = resolveHeaderDesign(
      { surface: { background: { hex: "#12372a" } }, text: { hex: "#fde68a" } },
      ctx,
    );
    expect(r.style?.["--hd-fg"]).toBe("#fde68a");
    const muted = r.style?.["--hd-muted"] as string;
    expect(
      headerContrastIssues(
        { surface: { background: { hex: "#12372a" } }, text: { hex: muted } },
        ctx,
      ),
    ).toEqual([]);
    // mid-grey background: a softened colour would fall under 4.5:1, so the full foreground is kept
    const grey = resolveHeaderDesign(
      { surface: { background: { hex: "#6b7280" } }, text: { hex: "#ffffff" } },
      ctx,
    );
    expect(grey.style?.["--hd-muted"]).toBe("#ffffff");
  });

  it("an icon colour is its own token and a role follows the palette", () => {
    const r = resolveHeaderDesign(
      { icon: { role: "brand" } },
      { ...ctx, primaryColor: "#0b5fff" },
    );
    expect(r.attrs).toEqual({ "data-hd": "hic" });
    expect(r.style).toEqual({ "--hd-icon": "#0b5fff" });
    expect(r.coloured).toBe(false);
  });

  it("colour tokens come first and compose with the structural ones", () => {
    expect(
      resolveHeaderDesign(
        {
          surface: { background: { hex: "#000000" } },
          icon: { hex: "#ffffff" },
          height: "tall",
          shadow: "soft",
        },
        ctx,
      ).attrs,
    ).toEqual({ "data-hd": "hbg htx hic hh-t hx-s" });
  });
});

describe("sticky on-scroll-up (V7c-1)", () => {
  it("emits its own token and keeps the in-page offset (the header comes back on the first upward scroll)", () => {
    expect(resolveHeaderDesign({ sticky: "on-scroll-up" }).attrs).toEqual({
      "data-hd": "hs-u",
    });
    expect(resolveHeaderDesign({ sticky: "on-scroll-up" }).sticky).toBe(
      "on-scroll-up",
    );
  });

  const H = 100;
  const at = (y: number, prev = { hidden: false, lastY: 0 }, pinned = false) =>
    stepScrollUp(prev, y, H, pinned);

  it("never hides within the header's own height of the top", () => {
    expect(at(H, { hidden: true, lastY: 500 })).toEqual({
      hidden: false,
      lastY: H,
    });
    expect(at(40)).toEqual({ hidden: false, lastY: 40 });
  });

  it("overscroll above the top counts as the top", () => {
    expect(at(-60, { hidden: true, lastY: 300 })).toEqual({
      hidden: false,
      lastY: 0,
    });
  });

  it("hides on a downward movement past the header, shows on the first upward one", () => {
    const down = at(300, { hidden: false, lastY: 200 });
    expect(down).toEqual({ hidden: true, lastY: 300 });
    const up = at(290, down);
    expect(up).toEqual({ hidden: false, lastY: 290 });
    expect(at(700, up).hidden).toBe(true);
  });

  it("jitter below the threshold changes nothing", () => {
    const state = { hidden: true, lastY: 400 };
    expect(at(400 - (SCROLL_UP_JITTER_PX - 1), state)).toBe(state);
    expect(
      at(400 + (SCROLL_UP_JITTER_PX - 1), { hidden: false, lastY: 400 }),
    ).toEqual({ hidden: false, lastY: 400 });
  });

  it("never hides while the shopper is working inside the header", () => {
    expect(at(900, { hidden: true, lastY: 800 }, true)).toEqual({
      hidden: false,
      lastY: 900,
    });
    expect(at(900, { hidden: false, lastY: 800 }, true).hidden).toBe(false);
  });

  it("a long scroll replays deterministically", () => {
    const path = [0, 50, 120, 220, 400, 396, 380, 600, 640, 639, 200, 90, 0];
    const hidden: boolean[] = [];
    let state = { hidden: false, lastY: 0 };
    for (const y of path) {
      state = at(y, state);
      hidden.push(state.hidden);
    }
    expect(hidden).toEqual([
      false,
      false,
      true,
      true,
      true,
      false,
      false,
      true,
      true,
      true,
      false,
      false,
      false,
    ]);
  });
});
