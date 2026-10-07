import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRESENTATION_CONFIG,
  normalizePresentationConfig,
} from "../config";
import {
  normalizePalette,
  PALETTE_ROLES,
  resolvePalette,
  suggestAccent,
} from "../palette";

const fixture = JSON.parse(
  readFileSync(
    resolve(
      __dirname,
      "../../../../../tests/Fixtures/presentation/palette.json",
    ),
    "utf8",
  ),
) as {
  cases: Array<{
    name: string;
    input: unknown;
    expected: Record<string, string> | null;
  }>;
};

describe("palette roles — shared fixture (V5a)", () => {
  for (const c of fixture.cases) {
    it(c.name, () => {
      const out = normalizePalette(c.input);
      expect(out ?? null).toEqual(c.expected);
      if (c.expected)
        expect(Object.keys(out!)).toEqual(Object.keys(c.expected));
      const config = normalizePresentationConfig({ palette: c.input });
      if (c.expected === null) expect("palette" in config).toBe(false);
      else expect(config.palette).toEqual(c.expected);
    });
  }
});

describe("palette — config integration (V5a)", () => {
  it("absent palette ⇒ the normalised config is unchanged and the version stays 3", () => {
    const plain = normalizePresentationConfig({});
    expect("palette" in plain).toBe(false);
    expect(plain.version).toBe(3);
    expect(normalizePresentationConfig({ palette: { text: "bad" } })).toEqual(
      plain,
    );
    expect("palette" in DEFAULT_PRESENTATION_CONFIG).toBe(false);
  });

  it("is idempotent and never touches brand or accent", () => {
    const once = normalizePresentationConfig({
      primaryColor: "#12372a",
      accentColor: "#C8A24A",
      palette: { surface: "#FAFAFA" },
    });
    expect(normalizePresentationConfig(once)).toEqual(once);
    expect(once.primaryColor).toBe("#12372a");
    expect(once.accentColor).toBe("#C8A24A");
  });

  it("has exactly the contract's seven roles", () => {
    expect([...PALETTE_ROLES]).toEqual([
      "surface",
      "surfaceAlt",
      "text",
      "heading",
      "link",
      "border",
      "overlay",
    ]);
  });
});

describe("resolvePalette (V5a)", () => {
  it("an unset role is null — the renderer keeps today's token (absent ⇒ unchanged)", () => {
    const r = resolvePalette({ primaryColor: "#12372a", accentColor: null });
    expect(r.brand).toBe("#12372a");
    expect(r.accent).toBeNull();
    for (const role of PALETTE_ROLES) expect(r[role]).toBeNull();
  });

  it("brand is primaryColor, accent is accentColor, the rest come from palette", () => {
    const r = resolvePalette({
      primaryColor: "#12372a",
      accentColor: "#c8a24a",
      palette: { text: "#101010", link: "#0b5fff" },
    });
    expect(r).toMatchObject({
      brand: "#12372a",
      accent: "#c8a24a",
      text: "#101010",
      link: "#0b5fff",
      surface: null,
    });
  });

  it("an unsafe accent never resolves", () => {
    expect(
      resolvePalette({ primaryColor: "#12372a", accentColor: "red" }).accent,
    ).toBeNull();
  });

  it("the accent suggestion is editor-only, a valid hex, and not the brand itself", () => {
    const s = suggestAccent("#12372a");
    expect(s).toMatch(/^#[0-9a-f]{6}$/);
    expect(s).not.toBe("#12372a");
  });
});
