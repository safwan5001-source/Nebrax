import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRESENTATION_CONFIG,
  normalizePresentationConfig,
} from "../config";
import {
  normalizeColorRef,
  normalizeSectionDesign,
  SECTION_DESIGN_CAPABILITIES,
} from "../section-design";

const fixture = JSON.parse(
  readFileSync(
    resolve(
      __dirname,
      "../../../../../tests/Fixtures/presentation/section-design.json",
    ),
    "utf8",
  ),
) as {
  capabilities: Record<string, Record<string, true | string[]>>;
  cases: Array<{
    name: string;
    type: string;
    input: unknown;
    expected: Record<string, unknown> | null;
  }>;
};

describe("section design — shared fixture with the PHP authority (V5b)", () => {
  for (const c of fixture.cases) {
    it(c.name, () => {
      const out = normalizeSectionDesign(c.type, c.input);
      expect(out ?? null).toEqual(c.expected);
      if (c.expected)
        expect(JSON.stringify(out)).toBe(JSON.stringify(c.expected)); // key order too
      expect(normalizeSectionDesign(c.type, out)).toEqual(out); // idempotent
    });
  }

  it("the per-type capability registry is identical in PHP and TS", () => {
    expect(JSON.parse(JSON.stringify(SECTION_DESIGN_CAPABILITIES))).toEqual(
      fixture.capabilities,
    );
  });
});

describe("section design — document integration (V5b)", () => {
  const section = (design: unknown) => ({
    homepage: { sections: [{ id: "s1", type: "hero", visible: true, design }] },
  });

  it("a document without design is byte-identical and the version stays 3", () => {
    const plain = normalizePresentationConfig(section(undefined));
    expect("design" in plain.homepage.sections[0]).toBe(false);
    expect(plain.version).toBe(3);
    expect(normalizePresentationConfig(section({ radius: "nope" }))).toEqual(
      plain,
    );
    for (const s of DEFAULT_PRESENTATION_CONFIG.homepage.sections)
      expect("design" in s).toBe(false);
  });

  it("a declared group is kept on the section, after `content`", () => {
    const config = normalizePresentationConfig(
      section({ spacing: { top: "lg" }, radius: "md" }),
    );
    expect(config.homepage.sections[0].design).toEqual({
      spacing: { top: "lg" },
      radius: "md",
    });
  });

  it("a type that does not declare a group never keeps it", () => {
    const config = normalizePresentationConfig({
      homepage: {
        sections: [
          {
            id: "w1",
            type: "wholesale",
            visible: true,
            design: { radius: "pill", spacing: { top: "sm" } },
          },
        ],
      },
    });
    expect(config.homepage.sections[0].design).toEqual({
      spacing: { top: "sm" },
    });
  });

  it("the whole document is idempotent", () => {
    const once = normalizePresentationConfig(
      section({
        background: {
          kind: "gradient",
          from: { role: "brand" },
          to: { hex: "#ABCDEF" },
          direction: "to-end",
        },
      }),
    );
    expect(normalizePresentationConfig(once)).toEqual(once);
  });
});

describe("colour references (V5b)", () => {
  it("never carry css, rgb(), names or short hex", () => {
    for (const bad of [
      "red",
      "rgb(0,0,0)",
      "#fff",
      { hex: "#12345" },
      { role: "primary" },
      { css: "red" },
      null,
      7,
      [],
    ]) {
      expect(normalizeColorRef(bad)).toBeUndefined();
    }
  });
});
