import { describe, expect, it } from "vitest";
import {
  addBlock,
  allBlockIds,
  blockOf,
  canAddBlock,
  canAddKind,
  canDuplicate,
  duplicateBlock,
  findBlock,
  moveBlock,
  removeBlock,
  setAlign,
  setButtonHref,
  setButtonLabel,
  setButtonStyle,
  setCalloutIcon,
  setCalloutTone,
  setCaption,
  setDividerStyle,
  setHeadingLevel,
  setImageLink,
  setImageMedia,
  setSpacerSize,
  setText,
} from "../content-blocks-edit";
import { type ContentBlocks, MAX_COLUMN_BLOCKS, MAX_CONTENT_BLOCKS, normalizeContentBlocks } from "../presentation/content-blocks";
import { sanitizeContentHref } from "../presentation/section-content";

const M = "0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d5e";
const M2 = "1c9a7d3f-4e4b-4b64-8d8f-9a2b3c4d5e6f";

const stable = (content: ContentBlocks) => normalizeContentBlocks(content, sanitizeContentHref) ?? { blocks: [] };
let n = 0;
const ids = () => `gen-${++n}`;

const sample: ContentBlocks = {
  blocks: [
    { id: "h", kind: "heading", text: "Title" },
    { id: "p", kind: "paragraph", text: "Body" },
    { id: "c", kind: "columns", columns: [[{ id: "c1", kind: "paragraph", text: "left" }], [{ id: "c2", kind: "spacer" }]] },
  ],
};

describe("content-blocks-edit (CUST-HV V9c-2)", () => {
  it("adds every kind at the end, returns its id and every result is stable under the normaliser", () => {
    for (const kind of ["heading", "paragraph", "button", "divider", "spacer", "callout", "columns"] as const) {
      const { content, id } = addBlock({ blocks: [] }, kind, null, { buttonLabel: "Button" }, "new");
      expect(id, kind).toBe("new");
      expect(stable(content), kind).toEqual(content);
    }
    const image = addBlock({ blocks: [] }, "image", null, { media: { mediaId: M } }, "pic");
    expect(image.content.blocks).toEqual([{ id: "pic", kind: "image", media: { mediaId: M } }]);
    expect(stable(image.content)).toEqual(image.content);
  });

  it("an image needs its picture; a button starts as a named draft that is kept", () => {
    expect(addBlock({ blocks: [] }, "image").id).toBeNull();
    expect(blockOf("button", "b", { buttonLabel: "Go" })).toEqual({ id: "b", kind: "button", label: "Go", href: "" });
    // a button with no name at all would be dropped by the normaliser; the editor never holds one
    expect(stable({ blocks: [{ id: "b", kind: "button", label: "", href: "" }] })).toEqual({ blocks: [] });
  });

  it("adds into a column of a columns block, up to four, and never another columns inside it", () => {
    let content = addBlock({ blocks: [] }, "columns", null, {}, "cols").content;
    for (let i = 0; i < MAX_COLUMN_BLOCKS; i += 1) {
      const result = addBlock(content, "spacer", { id: "cols", column: 1 }, {}, `s${i}`);
      expect(result.id).toBe(`s${i}`);
      content = result.content;
    }
    const block = content.blocks[0];
    if (block.kind !== "columns") throw new Error("columns");
    expect(block.columns[0]).toHaveLength(0);
    expect(block.columns[1]).toHaveLength(MAX_COLUMN_BLOCKS);
    expect(canAddBlock(content, { id: "cols", column: 1 })).toBe(false);
    expect(canAddBlock(content, { id: "cols", column: 0 })).toBe(true);
    expect(addBlock(content, "spacer", { id: "cols", column: 1 }, {}, "x").id).toBeNull();
    expect(canAddKind(content, "columns", { id: "cols", column: 0 })).toBe(false);
    expect(addBlock(content, "columns", { id: "cols", column: 0 }).id).toBeNull();
    expect(addBlock(content, "paragraph", { id: "missing", column: 0 }).id).toBeNull();
    expect(stable(content)).toEqual(content);
  });

  it("is capped at twelve top-level blocks", () => {
    let content: ContentBlocks = { blocks: [] };
    for (let i = 0; i < MAX_CONTENT_BLOCKS; i += 1) content = addBlock(content, "divider", null, {}, `d${i}`).content;
    expect(canAddBlock(content)).toBe(false);
    expect(addBlock(content, "divider").content).toBe(content);
  });

  it("removes a block wherever it is, a columns block with its children", () => {
    expect(removeBlock(sample, "p").blocks.map((b) => b.id)).toEqual(["h", "c"]);
    const inColumn = removeBlock(sample, "c1");
    const columns = inColumn.blocks[2];
    if (columns.kind !== "columns") throw new Error("columns");
    expect(columns.columns[0]).toEqual([]);
    expect(allBlockIds(removeBlock(sample, "c"))).toEqual(["h", "p"]);
  });

  it("moves within its own list only and is a no-op at the ends", () => {
    expect(moveBlock(sample, "p", -1).blocks.map((b) => b.id)).toEqual(["p", "h", "c"]);
    expect(moveBlock(sample, "h", -1)).toEqual(sample);
    expect(moveBlock(sample, "c", 1)).toEqual(sample);
    // a column's only child cannot leave its column
    expect(moveBlock(sample, "c1", 1)).toEqual(sample);
  });

  it("duplicates after the original with fresh ids — a columns block with fresh ids for its children too", () => {
    n = 0;
    const copy = duplicateBlock(sample, "c", ids);
    expect(copy.id).toBe("gen-1");
    expect(copy.content.blocks.map((b) => b.id)).toEqual(["h", "p", "c", "gen-1"]);
    expect(new Set(allBlockIds(copy.content)).size).toBe(allBlockIds(copy.content).length);
    expect(stable(copy.content)).toEqual(copy.content);
    const inColumn = duplicateBlock(sample, "c1", ids);
    const columns = inColumn.content.blocks[2];
    if (columns.kind !== "columns") throw new Error("columns");
    expect(columns.columns[0].map((b) => b.id)).toEqual(["c1", inColumn.id]);
    expect(duplicateBlock(sample, "missing").id).toBeNull();
  });

  it("refuses to duplicate into a full list", () => {
    let content: ContentBlocks = { blocks: [] };
    for (let i = 0; i < MAX_CONTENT_BLOCKS; i += 1) content = addBlock(content, "divider", null, {}, `d${i}`).content;
    expect(canDuplicate(content, "d0")).toBe(false);
    expect(duplicateBlock(content, "d0").content).toBe(content);
    expect(canDuplicate(sample, "h")).toBe(true);
  });

  it("text edits cut at the contract's code-point limits; the stored form is stable", () => {
    expect(findBlock(setText(sample, "h", "ع".repeat(130)), "h")).toMatchObject({ text: "ع".repeat(120) });
    expect(findBlock(setText(sample, "p", "x".repeat(700)), "p")).toMatchObject({ text: "x".repeat(600) });
    const callout = addBlock(sample, "callout", null, {}, "k").content;
    expect(findBlock(setText(callout, "k", "y".repeat(400)), "k")).toMatchObject({ text: "y".repeat(300) });
    // text of another kind is untouched
    expect(setText(sample, "c", "nope")).toEqual(sample);
  });

  it("level, alignment and styles: the default removes the field (absence, never stored)", () => {
    const level = setHeadingLevel(sample, "h", 3);
    expect(findBlock(level, "h")).toEqual({ id: "h", kind: "heading", text: "Title", level: 3 });
    expect(findBlock(setHeadingLevel(level, "h", 2), "h")).toEqual({ id: "h", kind: "heading", text: "Title" });

    const aligned = setAlign(sample, "p", "center");
    expect(findBlock(aligned, "p")).toEqual({ id: "p", kind: "paragraph", text: "Body", align: "center" });
    expect(findBlock(setAlign(aligned, "p", "start"), "p")).toEqual({ id: "p", kind: "paragraph", text: "Body" });
    expect(stable(setAlign(setHeadingLevel(sample, "h", 3), "h", "end"))).toEqual(setAlign(setHeadingLevel(sample, "h", 3), "h", "end"));

    let content = addBlock(sample, "button", null, { buttonLabel: "Go" }, "b").content;
    content = setButtonHref(content, "b", "/shop");
    content = setButtonStyle(content, "b", "outline");
    expect(findBlock(content, "b")).toEqual({ id: "b", kind: "button", label: "Go", href: "/shop", style: "outline" });
    expect(findBlock(setButtonStyle(content, "b", "solid"), "b")).toEqual({ id: "b", kind: "button", label: "Go", href: "/shop" });
    expect(findBlock(setButtonLabel(content, "b", "l".repeat(90)), "b")).toMatchObject({ label: "l".repeat(80) });
    expect(stable(content)).toEqual(content);

    content = addBlock(content, "divider", null, {}, "d").content;
    content = addBlock(content, "spacer", null, {}, "s").content;
    expect(findBlock(setDividerStyle(content, "d", "dots"), "d")).toEqual({ id: "d", kind: "divider", style: "dots" });
    expect(findBlock(setDividerStyle(setDividerStyle(content, "d", "dots"), "d", "line"), "d")).toEqual({ id: "d", kind: "divider" });
    expect(findBlock(setSpacerSize(content, "s", "lg"), "s")).toEqual({ id: "s", kind: "spacer", size: "lg" });
    expect(findBlock(setSpacerSize(setSpacerSize(content, "s", "lg"), "s", "md"), "s")).toEqual({ id: "s", kind: "spacer" });
  });

  it("callout tone and icon: info and 'no icon' remove the field", () => {
    let content = addBlock(sample, "callout", null, {}, "k").content;
    content = setCalloutTone(content, "k", "warning");
    content = setCalloutIcon(content, "k", "lock");
    expect(findBlock(content, "k")).toEqual({ id: "k", kind: "callout", text: "", tone: "warning", icon: "lock" });
    expect(findBlock(setCalloutTone(content, "k", "info"), "k")).toEqual({ id: "k", kind: "callout", text: "", icon: "lock" });
    expect(findBlock(setCalloutIcon(content, "k", null), "k")).toEqual({ id: "k", kind: "callout", text: "", tone: "warning" });
    expect(findBlock(setCalloutIcon(content, "k", undefined), "k")).toEqual({ id: "k", kind: "callout", text: "", tone: "warning" });
  });

  it("image: caption (blank removes it, cut at 120), link (blank removes it), picture swap keeps the rest", () => {
    const { content: withImage } = addBlock(sample, "image", null, { media: { mediaId: M } }, "i");
    let content = setCaption(withImage, "i", "Spring");
    content = setImageLink(content, "i", "/c/roses");
    expect(findBlock(content, "i")).toEqual({ id: "i", kind: "image", media: { mediaId: M }, caption: "Spring", link: "/c/roses" });
    expect(findBlock(setCaption(content, "i", "   "), "i")).toEqual({ id: "i", kind: "image", media: { mediaId: M }, link: "/c/roses" });
    expect(findBlock(setCaption(content, "i", "c".repeat(130)), "i")).toMatchObject({ caption: "c".repeat(120) });
    expect(findBlock(setImageLink(content, "i", ""), "i")).toEqual({ id: "i", kind: "image", media: { mediaId: M }, caption: "Spring" });
    const swapped = setImageMedia(content, "i", { mediaId: M2, decorative: true });
    expect(findBlock(swapped, "i")).toEqual({ id: "i", kind: "image", media: { mediaId: M2, decorative: true }, caption: "Spring", link: "/c/roses" });
    expect(stable(content)).toEqual(content);
  });

  it("edits reach a block inside a column", () => {
    const edited = setText(sample, "c1", "changed");
    const columns = edited.blocks[2];
    if (columns.kind !== "columns") throw new Error("columns");
    expect(columns.columns[0][0]).toMatchObject({ text: "changed" });
    expect(setSpacerSize(edited, "c2", "sm").blocks[2]).toMatchObject({ columns: [[{ text: "changed" }], [{ size: "sm" }]] });
  });
});
