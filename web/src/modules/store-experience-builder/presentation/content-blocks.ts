/**
 * CUST-HV V9c-1 — the shared content-block vocabulary of the `customContent` section (V0 §15, D-21). Byte-identical in web and
 * storefront, pinned to the PHP authority `StorefrontContentBlocksNormalizer` by the shared fixture
 * `tests/Fixtures/presentation/content-blocks.json`.
 *
 *   content = { blocks: Block[≤12] }
 *   Block   = heading   { id, kind, text≤120, level?: 3, align?: "center"|"end" }
 *           | paragraph { id, kind, text≤600, align?: "center"|"end" }
 *           | image     { id, kind, media: MediaRef, caption?≤120, link? }
 *           | button    { id, kind, label≤80, href, style?: "outline"|"link" }
 *           | divider   { id, kind, style?: "dots" }
 *           | spacer    { id, kind, size?: "sm"|"lg" }
 *           | callout   { id, kind, text≤300, tone?: "success"|"warning", icon?: IconKey }
 *           | columns   { id, kind, columns: [Block[≤4], Block[≤4]] }      // never a `columns` inside a column
 *
 * AWJ decisions (what V0 left open — not contract changes):
 *  - An existing document does not change: `heading` / `paragraph` without the new fields normalise to the same `{ id, kind, text }`,
 *    and the block ceiling went from 8 to 12 (a stored document stays valid). Defaults (level 2, start alignment, line divider,
 *    `md` spacer, `info` tone, solid button) are the ABSENCE of the field and are never stored, so equivalent documents match literally.
 *  - Alignment is logical (`center` / `end`), never left / right; the heading is an `h2` or `h3` (no `h1` — the hero owns it).
 *  - An image keeps its whole `MediaRef` and drops whole when it has no usable one. Per-locale alt and ownership belong to the generic
 *    media Publish gate (its scanner walks every `mediaId`, nested columns included). The caption is always kept; the link goes
 *    through the shared content-href sanitiser.
 *  - A button follows the CTA rules (a label without a link, or the reverse, is a draft that is kept and not drawn; a wholly empty
 *    one drops). `solid` is the absence; `soft` needs a colour to differ from solid, so it waits for the colour slice. No `colour`
 *    yet: an explicit colour on an outline / link button needs a contrast gate against the section background
 *    (`CtaColourContrast`) — its own slice; a button without a colour follows the section colours already proven.
 *  - `columns` is exactly two arrays (a missing one is completed empty), ≤ 4 blocks each, no nesting; stacking below `md` is fixed
 *    in the renderer, not a merchant choice.
 *  - A text block with empty text is kept (the editor creates a block, then the merchant types) and is not drawn. Ids are unique
 *    across the whole section, columns included; an invalid id is replaced by `block-{position}` (inside a column
 *    `col-{columns position}-{column}-{position}`) so normalising twice gives the same text.
 */

import { type IconKey, normalizeIconKey } from "./icon-registry";
import type { MediaRef } from "./media-ref";
import { normalizeMediaRef } from "./media-ref";

export const MAX_CONTENT_BLOCKS = 12;
export const MAX_COLUMN_BLOCKS = 4;
export const MAX_HEADING_LENGTH = 120;
export const MAX_PARAGRAPH_LENGTH = 600;
export const MAX_CALLOUT_LENGTH = 300;
export const MAX_BLOCK_CAPTION_LENGTH = 120;
export const MAX_BLOCK_BUTTON_LABEL_LENGTH = 80;

export const CONTENT_BLOCK_KINDS = [
  "heading",
  "paragraph",
  "image",
  "button",
  "divider",
  "spacer",
  "callout",
  "columns",
] as const;
export type ContentBlockKind = (typeof CONTENT_BLOCK_KINDS)[number];

export const BLOCK_ALIGNS = ["center", "end"] as const;
export const BLOCK_BUTTON_STYLES = ["outline", "link"] as const;
export const BLOCK_DIVIDER_STYLES = ["dots"] as const;
export const BLOCK_SPACER_SIZES = ["sm", "lg"] as const;
export const BLOCK_CALLOUT_TONES = ["success", "warning"] as const;

export type BlockAlign = (typeof BLOCK_ALIGNS)[number];
export type BlockButtonStyle = (typeof BLOCK_BUTTON_STYLES)[number];
export type BlockDividerStyle = (typeof BLOCK_DIVIDER_STYLES)[number];
export type BlockSpacerSize = (typeof BLOCK_SPACER_SIZES)[number];
export type BlockCalloutTone = (typeof BLOCK_CALLOUT_TONES)[number];

export interface HeadingBlock {
  id: string;
  kind: "heading";
  text: string;
  level?: 3;
  align?: BlockAlign;
}
export interface ParagraphBlock {
  id: string;
  kind: "paragraph";
  text: string;
  align?: BlockAlign;
}
export interface ImageBlock {
  id: string;
  kind: "image";
  media: MediaRef;
  caption?: string;
  link?: string;
}
export interface ButtonBlock {
  id: string;
  kind: "button";
  label: string;
  href: string;
  style?: BlockButtonStyle;
}
export interface DividerBlock {
  id: string;
  kind: "divider";
  style?: BlockDividerStyle;
}
export interface SpacerBlock {
  id: string;
  kind: "spacer";
  size?: BlockSpacerSize;
}
export interface CalloutBlock {
  id: string;
  kind: "callout";
  text: string;
  tone?: BlockCalloutTone;
  icon?: IconKey;
}
/** A block that may sit inside a column (everything except `columns`). */
export type LeafBlock =
  | HeadingBlock
  | ParagraphBlock
  | ImageBlock
  | ButtonBlock
  | DividerBlock
  | SpacerBlock
  | CalloutBlock;
export interface ColumnsBlock {
  id: string;
  kind: "columns";
  columns: [LeafBlock[], LeafBlock[]];
}
export type ContentBlock = LeafBlock | ColumnsBlock;

export interface ContentBlocks {
  blocks: ContentBlock[];
}

const PHP_TRIM_CHARS = new Set([" ", "\t", "\n", "\r", "\0", "\x0B"]);

function phpTrim(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && PHP_TRIM_CHARS.has(value[start])) start += 1;
  while (end > start && PHP_TRIM_CHARS.has(value[end - 1])) end -= 1;
  return value.slice(start, end);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function oneOf<T extends string>(
  value: unknown,
  list: readonly T[],
): T | undefined {
  return typeof value === "string" &&
    (list as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

function blockId(value: unknown, fallback: string): string {
  const id = typeof value === "string" ? phpTrim(value) : "";
  return /^[a-zA-Z0-9_-]{1,64}$/.test(id) ? id : fallback;
}

/** Heading / paragraph text as it always was: both ends trimmed, then cut at N code points. */
function legacyText(value: unknown, max: number): string {
  return Array.from(phpTrim(typeof value === "string" ? value : ""))
    .slice(0, max)
    .join("");
}

/** Every other text: kept as written (cut at N code points); whitespace alone is absence. */
function text(value: unknown, max: number): string {
  if (typeof value !== "string" || phpTrim(value) === "") return "";
  return Array.from(value).slice(0, max).join("");
}

type Sanitize = (value: string) => string;

function normalizeLeaf(
  kind: ContentBlockKind,
  id: string,
  raw: Record<string, unknown>,
  sanitizeHref: Sanitize,
): LeafBlock | null {
  switch (kind) {
    case "heading": {
      const block: HeadingBlock = {
        id,
        kind,
        text: legacyText(raw.text, MAX_HEADING_LENGTH),
      };
      if (raw.level === 3) block.level = 3;
      const align = oneOf(raw.align, BLOCK_ALIGNS);
      if (align) block.align = align;
      return block;
    }
    case "paragraph": {
      const block: ParagraphBlock = {
        id,
        kind,
        text: legacyText(raw.text, MAX_PARAGRAPH_LENGTH),
      };
      const align = oneOf(raw.align, BLOCK_ALIGNS);
      if (align) block.align = align;
      return block;
    }
    case "image": {
      const media = normalizeMediaRef(raw.media);
      if (!media) return null;
      const block: ImageBlock = { id, kind, media };
      const caption = text(raw.caption, MAX_BLOCK_CAPTION_LENGTH);
      if (caption !== "") block.caption = caption;
      const link = sanitizeHref(typeof raw.link === "string" ? raw.link : "");
      if (link !== "") block.link = link;
      return block;
    }
    case "button": {
      const label = text(raw.label, MAX_BLOCK_BUTTON_LABEL_LENGTH);
      const href = sanitizeHref(typeof raw.href === "string" ? raw.href : "");
      if (label === "" && href === "") return null;
      const block: ButtonBlock = { id, kind, label, href };
      const style = oneOf(raw.style, BLOCK_BUTTON_STYLES);
      if (style) block.style = style;
      return block;
    }
    case "divider": {
      const block: DividerBlock = { id, kind };
      const style = oneOf(raw.style, BLOCK_DIVIDER_STYLES);
      if (style) block.style = style;
      return block;
    }
    case "spacer": {
      const block: SpacerBlock = { id, kind };
      const size = oneOf(raw.size, BLOCK_SPACER_SIZES);
      if (size) block.size = size;
      return block;
    }
    case "callout": {
      const block: CalloutBlock = {
        id,
        kind,
        text: text(raw.text, MAX_CALLOUT_LENGTH),
      };
      const tone = oneOf(raw.tone, BLOCK_CALLOUT_TONES);
      if (tone) block.tone = tone;
      const icon = normalizeIconKey(raw.icon);
      if (icon) block.icon = icon;
      return block;
    }
    default:
      return null;
  }
}

function normalizeList(
  raw: unknown,
  max: number,
  allowColumns: boolean,
  seen: Set<string>,
  sanitizeHref: Sanitize,
  prefix: string,
): ContentBlock[] {
  const out: ContentBlock[] = [];
  const list = Array.isArray(raw) ? raw : [];
  for (let index = 0; index < list.length; index += 1) {
    const entry = list[index];
    if (!isRecord(entry)) continue;
    const kind = oneOf(entry.kind, CONTENT_BLOCK_KINDS);
    if (!kind || (kind === "columns" && !allowColumns)) continue;
    const id = blockId(entry.id, `${prefix}${index}`);
    if (seen.has(id)) continue;
    // a `columns` block claims its id before its children, so priority follows reading order
    seen.add(id);
    let block: ContentBlock | null;
    if (kind === "columns") {
      const source = Array.isArray(entry.columns) ? entry.columns : [];
      const columns = [0, 1].map(
        (column) =>
          normalizeList(
            source[column],
            MAX_COLUMN_BLOCKS,
            false,
            seen,
            sanitizeHref,
            `col-${index}-${column}-`,
          ) as LeafBlock[],
      ) as [LeafBlock[], LeafBlock[]];
      block = { id, kind, columns };
    } else {
      block = normalizeLeaf(kind, id, entry, sanitizeHref);
    }
    if (!block) {
      seen.delete(id);
      continue;
    }
    out.push(block);
    if (out.length >= max) break;
  }
  return out;
}

/** `undefined` = no usable block (an empty section is not stored). */
export function normalizeContentBlocks(
  raw: unknown,
  sanitizeHref: Sanitize,
): ContentBlocks | undefined {
  if (!isRecord(raw)) return undefined;
  const blocks = normalizeList(
    raw.blocks,
    MAX_CONTENT_BLOCKS,
    true,
    new Set<string>(),
    sanitizeHref,
    "block-",
  );
  return blocks.length === 0 ? undefined : { blocks };
}

/** Whether a block would draw anything: text blocks need text, a button a label AND a link, a column at least one drawn child. */
export function blockHasContent(block: ContentBlock): boolean {
  switch (block.kind) {
    case "heading":
    case "paragraph":
    case "callout":
      return block.text.trim() !== "";
    case "button":
      return block.label.trim() !== "" && block.href !== "";
    case "columns":
      return block.columns.some((column) => column.some(blockHasContent));
    default:
      return true;
  }
}
