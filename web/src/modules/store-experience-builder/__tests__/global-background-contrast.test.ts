import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_PRESENTATION_CONFIG, type StorefrontPresentationConfig } from "../presentation/config";
import { gradientInterval, luminance, parseHex } from "../presentation/contrast-engine";
import {
  GLOBAL_FOREGROUND_MUTED,
  GLOBAL_FOREGROUND_TEXT,
  failingForegrounds,
  globalBackgroundPaint,
  globalBackgroundVerdict,
  globalForegrounds,
} from "../presentation/global-background-contrast";
import { STOREFRONT_BACKGROUND_DIRECTIONS, type StorefrontBackground } from "../presentation/storefront-background";

type Fixture = {
  foregrounds: { text: string; muted: string };
  cases: Array<{
    name: string;
    config: { primaryColor: string; accentColor: string | null; palette: Record<string, string> };
    background: StorefrontBackground;
    expect: { reason: string | null; failing: string[] | null; min: number | null; max: number | null };
  }>;
};

const fixture = JSON.parse(
  readFileSync(resolve(__dirname, "../../../../../tests/Fixtures/presentation/global-background-contrast.json"), "utf8"),
) as Fixture;

const config = (over: Partial<StorefrontPresentationConfig> = {}): StorefrontPresentationConfig => ({
  ...DEFAULT_PRESENTATION_CONFIG,
  primaryColor: "#12372a",
  backgroundColor: "#f8f9fa",
  ...over,
});

const SAFE: StorefrontBackground = { kind: "gradient", from: { hex: "#f8f9fa" }, to: { hex: "#eff1f2" }, direction: "to-bottom" };
const UNSAFE: StorefrontBackground = { kind: "gradient", from: { hex: "#0b0b0b" }, to: { hex: "#1a1a1a" }, direction: "to-bottom" };

describe("global background contrast — shared PHP/TS fixture (P3-A-06)", () => {
  it("uses the same fixed page foregrounds as the PHP authority", () => {
    expect(GLOBAL_FOREGROUND_TEXT).toBe(fixture.foregrounds.text);
    expect(GLOBAL_FOREGROUND_MUTED).toBe(fixture.foregrounds.muted);
  });

  for (const c of fixture.cases) {
    it(c.name, () => {
      const cfg = config({
        primaryColor: c.config.primaryColor,
        accentColor: c.config.accentColor,
        palette: c.config.palette as StorefrontPresentationConfig["palette"],
        background: c.background,
      });
      const paint = globalBackgroundPaint(cfg);
      expect(paint.reason).toBe(c.expect.reason);
      if (c.expect.failing === null) {
        expect(paint.interval).toBeNull();
        return;
      }
      expect(paint.interval).not.toBeNull();
      expect(failingForegrounds(globalForegrounds(cfg), paint.interval!)).toEqual(c.expect.failing);
      expect(paint.interval!.min).toBeCloseTo(c.expect.min!, 5);
      expect(paint.interval!.max).toBeCloseTo(c.expect.max!, 5);
    });
  }
});

describe("global background contrast — verdict (P3-A-06)", () => {
  it("a light gradient is ready, a dark one is insufficient, and the failing roles are named", () => {
    expect(globalBackgroundVerdict(config({ background: SAFE }))).toMatchObject({ kind: "gradient", status: "ready", failing: [] });
    expect(globalBackgroundVerdict(config({ background: UNSAFE }))).toMatchObject({
      kind: "gradient",
      status: "insufficient",
      failing: ["text", "muted", "brand"],
    });
  });

  it("an interior dip fails although both ends pass (luminance is convex along the line)", () => {
    const from = parseHex("#fce8d1")!;
    const to = parseHex("#a6faff")!;
    const muted = luminance(...(parseHex(GLOBAL_FOREGROUND_MUTED) as [number, number, number]));
    const needed = 4.5 * (muted + 0.05) - 0.05;
    expect(luminance(...from)).toBeGreaterThan(needed);
    expect(luminance(...to)).toBeGreaterThan(needed);
    expect(gradientInterval(from, to).min).toBeLessThan(needed);
    const verdict = globalBackgroundVerdict(
      config({ background: { kind: "gradient", from: { hex: "#fce8d1" }, to: { hex: "#a6faff" }, direction: "to-end" } }),
    );
    expect(verdict).toMatchObject({ status: "insufficient", failing: ["muted"] });
  });

  it("every logical direction gives the same verdict (RTL and LTR cannot differ)", () => {
    for (const direction of STOREFRONT_BACKGROUND_DIRECTIONS) {
      expect(globalBackgroundVerdict(config({ background: { ...SAFE, direction } as StorefrontBackground })).status).toBe("ready");
      expect(globalBackgroundVerdict(config({ background: { ...UNSAFE, direction } as StorefrontBackground })).status).toBe("insufficient");
    }
  });

  it("solid backgrounds (legacy colour or an authored solid) are outside the policy", () => {
    expect(globalBackgroundVerdict(config({ backgroundColor: "#111827" })).status).toBe("none");
    expect(globalBackgroundVerdict(config({ background: { kind: "solid", color: { hex: "#102030" } } })).status).toBe("none");
  });

  it("explicit section text on the page is judged against the real paint; own-surface sections are independent", () => {
    const sections = (type: string, design: object) => ({
      ...DEFAULT_PRESENTATION_CONFIG.homepage,
      sections: [{ id: "s", type, visible: true, design }],
    });
    const white = { text: { body: { hex: "#ffffff" } } };
    const on = globalBackgroundVerdict(config({ backgroundColor: "#111827", background: SAFE, homepage: sections("benefits", white) as never }));
    expect(on.sectionText).toEqual([{ index: 0, field: "body" }]);
    expect(on.status).toBe("insufficient");
    for (const type of ["hero", "appPromo", "wholesale", "banner", "deliveryPromise"]) {
      expect(globalBackgroundVerdict(config({ background: SAFE, homepage: sections(type, white) as never })).sectionText).toEqual([]);
    }
    const ownBackground = { background: { kind: "solid", color: { hex: "#102030" } }, ...white };
    expect(globalBackgroundVerdict(config({ background: SAFE, homepage: sections("benefits", ownBackground) as never })).sectionText).toEqual([]);
  });
});

describe("global background contrast — picture (P3-A-06 Checkpoint B)", () => {
  const picture = (extra: object = {}): StorefrontBackground =>
    ({ kind: "media", media: { mediaId: "0b9d6a3e-1f5c-4a8e-9a47-2c1d3e4f5a6b", decorative: true }, ...extra }) as StorefrontBackground;
  const bounds = (min: [number, number, number], max: [number, number, number]) => () => ({ min, max });

  it("no evidence is unproven (fail closed), and so is a missing phone picture's evidence", () => {
    expect(globalBackgroundVerdict(config({ background: picture() }), () => null).status).toBe("unproven");
    expect(globalBackgroundVerdict(config({ background: picture() })).status).toBe("unproven");
    const both = picture({ mobile: { mediaId: "7c1d3e4f-5a6b-4c8d-9e0f-1a2b3c4d5e6f", decorative: true } });
    let calls = 0;
    const lookup = () => (calls++ === 0 ? { min: [240, 240, 240] as [number, number, number], max: [255, 255, 255] as [number, number, number] } : null);
    expect(globalBackgroundVerdict(config({ background: both }), lookup).status).toBe("unproven");
  });

  it("a very light picture is ready; a mid-tone one needs a strong light overlay; a dark overlay never proves the dark page text", () => {
    expect(globalBackgroundVerdict(config({ background: picture() }), bounds([245, 245, 245], [255, 255, 255])).status).toBe("ready");
    const mid = bounds([90, 90, 90], [220, 220, 220]);
    expect(globalBackgroundVerdict(config({ background: picture() }), mid).status).toBe("insufficient");
    const light = (alpha: number) => picture({ overlay: { color: { role: "surface" }, alpha } });
    expect(globalBackgroundVerdict(config({ background: light(40) }), mid).status).toBe("insufficient");
    expect(globalBackgroundVerdict(config({ background: light(90) }), mid).status).toBe("ready");
    const dark = picture({ overlay: { color: { role: "overlay" }, alpha: 90 } });
    expect(globalBackgroundVerdict(config({ background: dark }), mid).status).toBe("insufficient");
  });

  it("the backgroundColor fallback under the picture is part of the proof", () => {
    const light = bounds([250, 250, 250], [255, 255, 255]);
    expect(globalBackgroundVerdict(config({ background: picture(), backgroundColor: "#f8f9fa" }), light).status).toBe("ready");
    expect(globalBackgroundVerdict(config({ background: picture(), backgroundColor: "#111827" }), light)).toMatchObject({
      status: "insufficient",
    });
  });
});
