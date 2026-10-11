/**
 * CUST-HV V9c-1 — what the published storefront draws for a `customContent` section (V0 §15).
 *
 * The server publishes, per image, what the browser may load (`presentation_media`, keyed by the reference's JSON path:
 * `homepage.sections.{i}.content.blocks.{j}.media`, or `…blocks.{j}.columns.{c}.{k}.media` inside a column). This module joins
 * them back to the block. Nothing is guessed: an image whose picture the server did not resolve is omitted, a text block with no
 * text and a button without both label and link are omitted, and a `columns` block with nothing to draw is omitted whole.
 */

import type { PresentationHomeSection } from "./config";
import {
  type ButtonBlock,
  blockHasContent,
  type CalloutBlock,
  type ContentBlock,
  type DividerBlock,
  type HeadingBlock,
  type LeafBlock,
  type ParagraphBlock,
  type SpacerBlock,
} from "./content-blocks";
import type { ResolvedMedia, ResolvedMediaMap } from "./media-ref";
import { customContentOf } from "./section-content";

export interface ImageView {
  id: string;
  kind: "image";
  media: ResolvedMedia;
  /** Alt text for the visitor's locale; `""` for a decorative picture. */
  alt: string;
  caption: string;
  /** The merchant's own link (already content-sanitised); the page turns it into a destination. */
  link: string | null;
}

export type ViewLeaf =
  | HeadingBlock
  | ParagraphBlock
  | ButtonBlock
  | DividerBlock
  | SpacerBlock
  | CalloutBlock
  | ImageView;

export interface ColumnsView {
  id: string;
  kind: "columns";
  columns: [ViewLeaf[], ViewLeaf[]];
}

export type ViewBlock = ViewLeaf | ColumnsView;

function altFor(media: ResolvedMedia, locale: string): string {
  if (media.decorative) return "";
  return media.alt[locale === "ar" ? "ar" : "en"] ?? "";
}

function resolveLeaf(
  block: LeafBlock,
  path: string,
  resolved: ResolvedMediaMap,
  locale: string,
): ViewLeaf | null {
  if (block.kind === "image") {
    const media = resolved[`${path}.media`];
    if (!media) return null;
    return {
      id: block.id,
      kind: "image",
      media,
      alt: altFor(media, locale),
      caption: block.caption ?? "",
      link: block.link ?? null,
    };
  }
  return blockHasContent(block) ? block : null;
}

export function resolveContentBlocks(
  section: PresentationHomeSection,
  sectionIndex: number,
  resolved: ResolvedMediaMap,
  locale: string,
): ViewBlock[] {
  const out: ViewBlock[] = [];
  customContentOf(section).blocks.forEach((block: ContentBlock, index) => {
    const path = `homepage.sections.${sectionIndex}.content.blocks.${index}`;
    if (block.kind === "columns") {
      const columns = block.columns.map((column, c) =>
        column
          .map((leaf, k) =>
            resolveLeaf(leaf, `${path}.columns.${c}.${k}`, resolved, locale),
          )
          .filter((leaf): leaf is ViewLeaf => leaf !== null),
      ) as [ViewLeaf[], ViewLeaf[]];
      if (columns[0].length + columns[1].length > 0) {
        out.push({ id: block.id, kind: "columns", columns });
      }
      return;
    }
    const leaf = resolveLeaf(block, path, resolved, locale);
    if (leaf) out.push(leaf);
  });
  return out;
}

/** Whether a section is the original FAQ shape: nothing but headings and paragraphs (the only shape the accordion may fold). */
export function isTextOnly(blocks: readonly ContentBlock[]): boolean {
  return blocks.every(
    (block) => block.kind === "heading" || block.kind === "paragraph",
  );
}
