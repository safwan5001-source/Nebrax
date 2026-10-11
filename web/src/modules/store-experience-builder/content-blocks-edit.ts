/**
 * CUST-HV V9c-2 — pure edits of a `customContent` section's blocks (V0 §15). Like `gallery-edit.ts`: the editor never builds the stored shape by
 * hand — every change goes through these functions, which keep the invariants the normaliser would otherwise repair silently (≤ 12 blocks,
 * ≤ 4 per column, no nesting, unique ids across the section, absence rather than defaults or empty strings), so what the merchant sees is what is
 * stored. A block is addressed by its id; `parent` names the column a new block goes into.
 */
import {
  type BlockAlign,
  type BlockButtonStyle,
  type BlockCalloutTone,
  type BlockDividerStyle,
  type BlockSpacerSize,
  type ButtonBlock,
  type CalloutBlock,
  type ContentBlock,
  type ContentBlocks,
  type ContentBlockKind,
  type DividerBlock,
  type HeadingBlock,
  type ImageBlock,
  type LeafBlock,
  MAX_BLOCK_BUTTON_LABEL_LENGTH,
  MAX_BLOCK_CAPTION_LENGTH,
  MAX_CALLOUT_LENGTH,
  MAX_COLUMN_BLOCKS,
  MAX_CONTENT_BLOCKS,
  MAX_HEADING_LENGTH,
  MAX_PARAGRAPH_LENGTH,
  type ParagraphBlock,
  type SpacerBlock,
} from "./presentation/content-blocks";
import type { IconKey } from "./presentation/icon-registry";
import type { MediaRef } from "./presentation/media-ref";
import { newHomeSectionId } from "./presentation/section-capabilities";

/** Where a new block goes: the top level, or one of a `columns` block's two columns. */
export type BlockParent = { id: string; column: 0 | 1 } | null;

export type LeafKind = Exclude<ContentBlockKind, "columns">;

export const LEAF_KINDS: readonly LeafKind[] = ["heading", "paragraph", "image", "button", "divider", "spacer", "callout"];
export const BLOCK_KINDS: readonly ContentBlockKind[] = [...LEAF_KINDS, "columns"];

export function newBlockId(): string {
  return newHomeSectionId();
}

function cut(value: string, max: number): string {
  return Array.from(value).slice(0, max).join("");
}

function listAt(content: ContentBlocks, parent: BlockParent): readonly ContentBlock[] {
  if (!parent) return content.blocks;
  const columns = content.blocks.find((block) => block.id === parent.id);
  return columns?.kind === "columns" ? columns.columns[parent.column] : [];
}

export function canAddBlock(content: ContentBlocks, parent: BlockParent = null): boolean {
  if (!parent) return content.blocks.length < MAX_CONTENT_BLOCKS;
  const columns = content.blocks.find((block) => block.id === parent.id);
  return columns?.kind === "columns" && columns.columns[parent.column].length < MAX_COLUMN_BLOCKS;
}

/** Whether a kind may be added at `parent` (a column cannot hold another `columns`). */
export function canAddKind(content: ContentBlocks, kind: ContentBlockKind, parent: BlockParent = null): boolean {
  return canAddBlock(content, parent) && !(parent && kind === "columns");
}

export function allBlockIds(content: ContentBlocks): string[] {
  return content.blocks.flatMap((block) => (block.kind === "columns" ? [block.id, ...block.columns.flat().map((leaf) => leaf.id)] : [block.id]));
}

export function findBlock(content: ContentBlocks, id: string): ContentBlock | null {
  for (const block of content.blocks) {
    if (block.id === id) return block;
    if (block.kind === "columns") {
      const hit = block.columns.flat().find((leaf) => leaf.id === id);
      if (hit) return hit;
    }
  }
  return null;
}

/** The block a new one of `kind` starts as. An image needs its picture and a button needs a label to exist at all, so both take them here. */
export function blockOf(kind: LeafKind, id: string, init: { media?: MediaRef; buttonLabel?: string } = {}): LeafBlock | null {
  switch (kind) {
    case "heading":
      return { id, kind, text: "" };
    case "paragraph":
      return { id, kind, text: "" };
    case "image":
      return init.media ? { id, kind, media: init.media } : null;
    case "button":
      // a wholly empty button is not stored: it starts with a name, and no link (a draft that is not drawn yet)
      return { id, kind, label: cut(init.buttonLabel ?? "", MAX_BLOCK_BUTTON_LABEL_LENGTH), href: "" };
    case "divider":
      return { id, kind };
    case "spacer":
      return { id, kind };
    case "callout":
      return { id, kind, text: "" };
  }
}

/** Adds a block at the end of the top level or of a column; returns the new id (or `null` when it cannot be added). */
export function addBlock(
  content: ContentBlocks,
  kind: ContentBlockKind,
  parent: BlockParent = null,
  init: { media?: MediaRef; buttonLabel?: string } = {},
  id: string = newBlockId(),
): { content: ContentBlocks; id: string | null } {
  if (!canAddKind(content, kind, parent)) return { content, id: null };
  const block: ContentBlock | null = kind === "columns" ? { id, kind, columns: [[], []] } : blockOf(kind, id, init);
  if (!block) return { content, id: null };
  if (!parent) return { content: { blocks: [...content.blocks, block] }, id };
  return {
    content: {
      blocks: content.blocks.map((entry) =>
        entry.id === parent.id && entry.kind === "columns" && block.kind !== "columns"
          ? {
              ...entry,
              columns: entry.columns.map((column, index) => (index === parent.column ? [...column, block] : column)) as [LeafBlock[], LeafBlock[]],
            }
          : entry,
      ),
    },
    id,
  };
}

function mapLists(
  content: ContentBlocks,
  change: (list: ContentBlock[], parent: BlockParent) => ContentBlock[],
): ContentBlocks {
  const blocks = change(content.blocks, null).map((block) =>
    block.kind === "columns"
      ? {
          ...block,
          columns: block.columns.map((column, index) => change(column, { id: block.id, column: index as 0 | 1 }) as LeafBlock[]) as [LeafBlock[], LeafBlock[]],
        }
      : block,
  );
  return { blocks };
}

export function removeBlock(content: ContentBlocks, id: string): ContentBlocks {
  return mapLists(content, (list) => list.filter((block) => block.id !== id));
}

/** Moves a block one place within its own list (the top level or its column). */
export function moveBlock(content: ContentBlocks, id: string, delta: -1 | 1): ContentBlocks {
  return mapLists(content, (list) => {
    const index = list.findIndex((block) => block.id === id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= list.length) return list;
    const next = [...list];
    const [block] = next.splice(index, 1);
    next.splice(target, 0, block);
    return next;
  });
}

/** A copy of a block (and of every block inside a `columns`), each with a fresh id. */
function cloned(block: ContentBlock, ids: () => string): ContentBlock {
  const copy = structuredClone(block);
  copy.id = ids();
  if (copy.kind === "columns") {
    copy.columns = copy.columns.map((column) => column.map((leaf) => ({ ...leaf, id: ids() }))) as [LeafBlock[], LeafBlock[]];
  }
  return copy;
}

/** The copy goes right after the original (same list) — refused when that list is full. Returns the copy's id so the editor can select it. */
export function duplicateBlock(
  content: ContentBlocks,
  id: string,
  ids: () => string = newBlockId,
): { content: ContentBlocks; id: string | null } {
  let newId: string | null = null;
  const next = mapLists(content, (list, parent) => {
    const index = list.findIndex((block) => block.id === id);
    if (index < 0) return list;
    if (list.length >= (parent ? MAX_COLUMN_BLOCKS : MAX_CONTENT_BLOCKS)) return list;
    const copy = cloned(list[index], ids);
    newId = copy.id;
    const out = [...list];
    out.splice(index + 1, 0, copy);
    return out;
  });
  return newId ? { content: next, id: newId } : { content, id: null };
}

export function canDuplicate(content: ContentBlocks, id: string): boolean {
  return duplicateBlock(content, id, () => "probe").id !== null;
}

/** Replaces one block (found by id, wherever it lives) with `change(block)`. */
function updateBlock(content: ContentBlocks, id: string, change: (block: ContentBlock) => ContentBlock): ContentBlocks {
  return mapLists(content, (list) => list.map((block) => (block.id === id ? change(block) : block)));
}

function withoutKey<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  const { [key]: _drop, ...rest } = value;
  return rest;
}

export function setText(content: ContentBlocks, id: string, value: string): ContentBlocks {
  return updateBlock(content, id, (block) => {
    if (block.kind === "heading") return { ...block, text: cut(value, MAX_HEADING_LENGTH) };
    if (block.kind === "paragraph") return { ...block, text: cut(value, MAX_PARAGRAPH_LENGTH) };
    if (block.kind === "callout") return { ...block, text: cut(value, MAX_CALLOUT_LENGTH) };
    return block;
  });
}

/** `level`: `2` is the default and removes the field. */
export function setHeadingLevel(content: ContentBlocks, id: string, level: 2 | 3): ContentBlocks {
  return updateBlock(content, id, (block) => {
    if (block.kind !== "heading") return block;
    const rest = withoutKey(block, "level") as HeadingBlock;
    return level === 3 ? { ...rest, level: 3 } : rest;
  });
}

/** `start` is the default and removes the field. */
export function setAlign(content: ContentBlocks, id: string, align: BlockAlign | "start"): ContentBlocks {
  return updateBlock(content, id, (block) => {
    if (block.kind !== "heading" && block.kind !== "paragraph") return block;
    const rest = withoutKey(block, "align") as HeadingBlock | ParagraphBlock;
    return align === "start" ? rest : { ...rest, align };
  });
}

export function setImageMedia(content: ContentBlocks, id: string, media: MediaRef): ContentBlocks {
  return updateBlock(content, id, (block) => (block.kind === "image" ? { ...block, media } : block));
}

/** Code-point truncation; a blank value removes the field (absence, never an empty string). */
export function setCaption(content: ContentBlocks, id: string, value: string): ContentBlocks {
  const limited = cut(value, MAX_BLOCK_CAPTION_LENGTH);
  return updateBlock(content, id, (block) => {
    if (block.kind !== "image") return block;
    const rest = withoutKey(block, "caption") as ImageBlock;
    return limited.trim() === "" ? rest : { ...rest, caption: limited };
  });
}

/** An empty link removes the field; what is kept is judged by the shared content-href sanitiser when the document is normalised. */
export function setImageLink(content: ContentBlocks, id: string, href: string): ContentBlocks {
  return updateBlock(content, id, (block) => {
    if (block.kind !== "image") return block;
    const rest = withoutKey(block, "link") as ImageBlock;
    return href.trim() === "" ? rest : { ...rest, link: href };
  });
}

export function setButtonLabel(content: ContentBlocks, id: string, value: string): ContentBlocks {
  return updateBlock(content, id, (block) => (block.kind === "button" ? { ...block, label: cut(value, MAX_BLOCK_BUTTON_LABEL_LENGTH) } : block));
}

export function setButtonHref(content: ContentBlocks, id: string, href: string): ContentBlocks {
  return updateBlock(content, id, (block) => (block.kind === "button" ? { ...block, href } : block));
}

/** `solid` is the default and removes the field. */
export function setButtonStyle(content: ContentBlocks, id: string, style: BlockButtonStyle | "solid"): ContentBlocks {
  return updateBlock(content, id, (block) => {
    if (block.kind !== "button") return block;
    const rest = withoutKey(block, "style") as ButtonBlock;
    return style === "solid" ? rest : { ...rest, style };
  });
}

/** `line` is the default and removes the field. */
export function setDividerStyle(content: ContentBlocks, id: string, style: BlockDividerStyle | "line"): ContentBlocks {
  return updateBlock(content, id, (block) => {
    if (block.kind !== "divider") return block;
    const rest = withoutKey(block, "style") as DividerBlock;
    return style === "line" ? rest : { ...rest, style };
  });
}

/** `md` is the default and removes the field. */
export function setSpacerSize(content: ContentBlocks, id: string, size: BlockSpacerSize | "md"): ContentBlocks {
  return updateBlock(content, id, (block) => {
    if (block.kind !== "spacer") return block;
    const rest = withoutKey(block, "size") as SpacerBlock;
    return size === "md" ? rest : { ...rest, size };
  });
}

/** `info` is the default and removes the field. */
export function setCalloutTone(content: ContentBlocks, id: string, tone: BlockCalloutTone | "info"): ContentBlocks {
  return updateBlock(content, id, (block) => {
    if (block.kind !== "callout") return block;
    const rest = withoutKey(block, "tone") as CalloutBlock;
    return tone === "info" ? rest : { ...rest, tone };
  });
}

/** `null` removes the icon. */
export function setCalloutIcon(content: ContentBlocks, id: string, icon: IconKey | null | undefined): ContentBlocks {
  return updateBlock(content, id, (block) => {
    if (block.kind !== "callout") return block;
    const rest = withoutKey(block, "icon") as CalloutBlock;
    return icon ? { ...rest, icon } : rest;
  });
}
