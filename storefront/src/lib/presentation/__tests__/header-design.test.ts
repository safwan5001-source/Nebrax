import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizePresentationConfig } from "../config";
import {
  headerDesktopLayout,
  headerIsCompact,
  normalizeHeaderDesign,
  resolveHeaderDesign,
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
        header: { design: { layout: "mega", sticky: "on-scroll-up" } },
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
