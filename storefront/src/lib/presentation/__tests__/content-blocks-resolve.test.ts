import { describe, expect, it } from "vitest";
import type { PresentationHomeSection } from "../config";
import { isTextOnly, resolveContentBlocks } from "../content-blocks-resolve";
import type { ResolvedMedia, ResolvedMediaMap } from "../media-ref";

const A = "0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d5e";
const B = "1c9a7d3f-4e4b-4b64-8d8f-9a2b3c4d5e6f";

function media(over: Partial<ResolvedMedia> = {}): ResolvedMedia {
  return {
    width: 1600,
    height: 900,
    decorative: false,
    alt: { ar: "وردة", en: "Rose" },
    sources: [
      {
        kind: "w",
        width: 800,
        height: 450,
        format: "jpg",
        src: "/m/a/800.jpg",
      },
    ],
    ...over,
  };
}

const section = (blocks: unknown[]): PresentationHomeSection =>
  ({
    id: "cc",
    type: "customContent",
    visible: true,
    content: { blocks },
  }) as PresentationHomeSection;

describe("resolveContentBlocks (CUST-HV V9c-1)", () => {
  it("joins a top-level image to the server's media by JSON path", () => {
    const resolved: ResolvedMediaMap = {
      "homepage.sections.2.content.blocks.1.media": media(),
    };
    const view = resolveContentBlocks(
      section([
        { id: "h", kind: "heading", text: "Hi" },
        {
          id: "i",
          kind: "image",
          media: { mediaId: A },
          caption: "C",
          link: "/x",
        },
      ]),
      2,
      resolved,
      "en",
    );
    expect(view.map((b) => b.kind)).toEqual(["heading", "image"]);
    expect(view[1]).toMatchObject({
      id: "i",
      alt: "Rose",
      caption: "C",
      link: "/x",
    });
  });

  it("joins an image inside a column by its nested path", () => {
    const resolved: ResolvedMediaMap = {
      "homepage.sections.0.content.blocks.0.columns.1.0.media": media(),
    };
    const view = resolveContentBlocks(
      section([
        {
          id: "c",
          kind: "columns",
          columns: [
            [{ id: "p", kind: "paragraph", text: "left" }],
            [{ id: "i", kind: "image", media: { mediaId: A } }],
          ],
        },
      ]),
      0,
      resolved,
      "ar",
    );
    expect(view).toHaveLength(1);
    const columns = view[0];
    if (columns.kind !== "columns") throw new Error("expected columns");
    expect(columns.columns[0].map((b) => b.kind)).toEqual(["paragraph"]);
    expect(columns.columns[1][0]).toMatchObject({ kind: "image", alt: "وردة" });
  });

  it("omits what it cannot draw: an unresolved image, empty text, an incomplete button, an empty columns block", () => {
    const view = resolveContentBlocks(
      section([
        { id: "i", kind: "image", media: { mediaId: B } },
        { id: "p", kind: "paragraph", text: "   " },
        { id: "b1", kind: "button", label: "Go", href: "" },
        { id: "b2", kind: "button", label: "", href: "/x" },
        {
          id: "c",
          kind: "columns",
          columns: [[{ id: "e", kind: "callout", text: "" }], []],
        },
        { id: "ok", kind: "button", label: "Shop", href: "/shop" },
      ]),
      0,
      {},
      "en",
    );
    expect(view.map((b) => b.id)).toEqual(["ok"]);
  });

  it("a decorative picture has an empty alt in both locales, and a missing locale alt is empty (never invented)", () => {
    const resolved: ResolvedMediaMap = {
      "homepage.sections.0.content.blocks.0.media": media({ decorative: true }),
      "homepage.sections.0.content.blocks.1.media": media({
        alt: { ar: null, en: "Rose" },
      }),
    };
    const blocks = [
      { id: "a", kind: "image", media: { mediaId: A } },
      { id: "b", kind: "image", media: { mediaId: B } },
    ];
    const en = resolveContentBlocks(section(blocks), 0, resolved, "en");
    const ar = resolveContentBlocks(section(blocks), 0, resolved, "ar");
    expect(en.map((b) => (b.kind === "image" ? b.alt : null))).toEqual([
      "",
      "Rose",
    ]);
    expect(ar.map((b) => (b.kind === "image" ? b.alt : null))).toEqual([
      "",
      "",
    ]);
  });

  it("keeps spacers and dividers (they draw without content) and a columns block with one drawn child", () => {
    const view = resolveContentBlocks(
      section([
        { id: "s", kind: "spacer", size: "lg" },
        { id: "d", kind: "divider" },
        {
          id: "c",
          kind: "columns",
          columns: [[], [{ id: "x", kind: "paragraph", text: "hi" }]],
        },
      ]),
      0,
      {},
      "en",
    );
    expect(view.map((b) => b.kind)).toEqual(["spacer", "divider", "columns"]);
  });
});

describe("isTextOnly", () => {
  it("is the original FAQ shape only", () => {
    expect(
      isTextOnly([
        { id: "a", kind: "heading", text: "x" },
        { id: "b", kind: "paragraph", text: "y" },
      ]),
    ).toBe(true);
    expect(
      isTextOnly([
        { id: "a", kind: "heading", text: "x" },
        { id: "b", kind: "divider" },
      ]),
    ).toBe(false);
    expect(isTextOnly([])).toBe(true);
  });
});
