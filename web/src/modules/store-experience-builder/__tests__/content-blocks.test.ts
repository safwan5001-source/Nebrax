import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  blockHasContent,
  CONTENT_BLOCK_KINDS,
  MAX_COLUMN_BLOCKS,
  MAX_CONTENT_BLOCKS,
} from "../presentation/content-blocks";
import {
  MAX_CUSTOM_BLOCKS,
  normalizeOptionalSectionContent,
} from "../presentation/section-content";

interface Fixture {
  cases: Array<{ name: string; input: unknown; expected: unknown }>;
}

const fixture = JSON.parse(
  readFileSync(
    resolve(
      __dirname,
      "../../../../../tests/Fixtures/presentation/content-blocks.json",
    ),
    "utf8",
  ),
) as Fixture;

const normalize = (input: unknown) =>
  normalizeOptionalSectionContent("customContent", input);

/**
 * CUST-HV V9c-1 — the TS twin of PHP `StorefrontContentBlocksNormalizer`, pinned by the shared fixture. `expected: null` is
 * the section content being absent (TS `undefined`).
 */
describe("customContent blocks — shared fixture (V9c-1)", () => {
  for (const c of fixture.cases) {
    it(c.name, () => {
      expect(normalize(c.input) ?? null).toEqual(c.expected);
    });
    it(`${c.name} — idempotent, and key order is the contract`, () => {
      const once = normalize(c.input);
      expect(JSON.stringify(normalize(once))).toBe(JSON.stringify(once));
      if (c.expected)
        expect(JSON.stringify(once)).toBe(JSON.stringify(c.expected));
    });
  }
});

describe("customContent blocks — bounds and helpers", () => {
  it("the ceilings are the contract's", () => {
    expect(MAX_CUSTOM_BLOCKS).toBe(MAX_CONTENT_BLOCKS);
    expect(MAX_CONTENT_BLOCKS).toBe(12);
    expect(MAX_COLUMN_BLOCKS).toBe(4);
    expect(CONTENT_BLOCK_KINDS).toEqual([
      "heading",
      "paragraph",
      "image",
      "button",
      "divider",
      "spacer",
      "callout",
      "columns",
    ]);
  });

  it("a block draws only when it has something to draw", () => {
    expect(blockHasContent({ id: "a", kind: "paragraph", text: "  " })).toBe(
      false,
    );
    expect(blockHasContent({ id: "a", kind: "paragraph", text: "x" })).toBe(
      true,
    );
    expect(
      blockHasContent({ id: "a", kind: "button", label: "Go", href: "" }),
    ).toBe(false);
    expect(
      blockHasContent({ id: "a", kind: "button", label: "Go", href: "/go" }),
    ).toBe(true);
    expect(blockHasContent({ id: "a", kind: "divider" })).toBe(true);
    expect(
      blockHasContent({ id: "a", kind: "columns", columns: [[], []] }),
    ).toBe(false);
    expect(
      blockHasContent({
        id: "a",
        kind: "columns",
        columns: [[], [{ id: "b", kind: "spacer" }]],
      }),
    ).toBe(true);
  });
});
