"use client";

import { useEffect, useRef } from "react";
import { useMediaRefPreview } from "./media/use-media-ref-preview";
import {
  type CalloutBlock,
  type ContentBlock,
  type ImageBlock,
  type LeafBlock,
  blockHasContent,
} from "./presentation/content-blocks";
import { StoreIcon } from "./StoreIcon";

/**
 * CUST-HV V9c-2 — the Canvas's twin of the storefront's `CustomContentBand` for a section that uses the shared block vocabulary (V0 §15): the same
 * classes and the same decisions (what is drawn, heading level, logical alignment, spacer heights, callout accent and tone label), so the preview
 * shows what will be published. It differs only where an editor must: each picture's URL is the signed workspace preview (`useMediaRefPreview`),
 * the two columns stack by the SIMULATED device (`data-vp`, in the Canvas-only block of `store-preview.css`, not a media query against the host
 * window), nothing navigates (a button is a button-looking box; a click selects the section), and the editor's selected block is ringed and kept in view.
 */
export interface CanvasContentLabels {
  note: string;
  success: string;
  warning: string;
  empty: string;
  /** `Picture {number}` — the preview picture's name (the real alt text is the merchant's, judged at Publish). */
  item: string;
}

type Viewport = "desktop" | "tablet" | "mobile";

const ALIGN_CLASS = { center: "text-center", end: "text-end" } as const;
const SPACER_CLASS = { sm: "h-4", md: "h-8", lg: "h-14" } as const;
const CALLOUT_ACCENT = {
  info: "border-s-store-primary",
  success: "border-s-store-success",
  warning: "border-s-store-warning",
} as const;
const BUTTON_CLASS = {
  solid:
    "inline-flex h-10 max-w-full items-center rounded-store bg-store-primary px-4 text-sm font-bold text-store-primary-foreground",
  outline:
    "inline-flex h-10 max-w-full items-center rounded-store border-2 border-store-foreground/60 px-4 text-sm font-bold text-store-foreground",
  link: "inline-flex h-10 max-w-full items-center px-1 text-sm font-bold text-store-foreground underline decoration-2 underline-offset-4",
} as const;

function Selectable({ id, selected, children }: { id: string; selected: boolean; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // the editor's selection stays in view (the page does not jump)
    if (selected) ref.current?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [selected]);
  return (
    <div ref={ref} data-content-block={id} data-selected={selected ? "" : undefined} aria-current={selected ? "true" : undefined} className="min-w-0">
      {children}
    </div>
  );
}

function Picture({ block, label }: { block: ImageBlock; label: string }) {
  const src = useMediaRefPreview(block.media);
  return (
    <figure data-content-image="" className="min-w-0">
      {src ? (
        // biome-ignore lint/performance/noImgElement: editor-only signed preview URL, not a static import
        <img src={src} alt={block.media.decorative ? "" : label} decoding="async" className="h-auto w-full rounded-store" />
      ) : (
        <div className="aspect-video w-full rounded-store bg-store-surface" />
      )}
      {block.caption ? <figcaption className="mt-2 break-words text-xs leading-relaxed text-store-muted-foreground">{block.caption}</figcaption> : null}
    </figure>
  );
}

function Callout({ block, labels }: { block: CalloutBlock; labels: CanvasContentLabels }) {
  const tone = block.tone ?? "info";
  return (
    <aside
      data-content-callout={tone}
      className={`flex min-w-0 items-start gap-3 break-words rounded-store border border-store-border border-s-4 bg-store-surface px-4 py-3 ${CALLOUT_ACCENT[tone]}`}
    >
      {block.icon ? <StoreIcon name={block.icon} className="mt-0.5 size-5 text-store-foreground" /> : null}
      <p className="min-w-0 flex-1 whitespace-pre-line text-sm leading-relaxed text-store-foreground">
        <span className="sr-only">{tone === "info" ? labels.note : labels[tone]}: </span>
        {block.text}
      </p>
    </aside>
  );
}

function Leaf({ block, labels, number }: { block: LeafBlock; labels: CanvasContentLabels; number: number }) {
  switch (block.kind) {
    case "heading": {
      const cls = `break-words font-extrabold text-store-foreground ${block.level === 3 ? "text-base md:text-lg" : "text-lg md:text-xl"} ${
        block.align ? ALIGN_CLASS[block.align] : ""
      }`;
      return block.level === 3 ? <h3 className={cls}>{block.text}</h3> : <h2 className={cls}>{block.text}</h2>;
    }
    case "paragraph":
      return (
        <p className={`whitespace-pre-line break-words text-sm leading-relaxed text-store-muted-foreground ${block.align ? ALIGN_CLASS[block.align] : ""}`}>
          {block.text}
        </p>
      );
    case "image":
      return <Picture block={block} label={labels.item.replace("{number}", String(number))} />;
    case "button":
      return (
        <div data-content-button="">
          <span className={BUTTON_CLASS[block.style ?? "solid"]} data-cta-style={block.style ?? "solid"}>
            <span className="min-w-0 truncate">{block.label.trim()}</span>
          </span>
        </div>
      );
    case "divider":
      return block.style === "dots" ? (
        <div aria-hidden="true" data-content-divider="dots" className="flex justify-center gap-2 py-1 text-store-border">
          <span className="size-1.5 rounded-full bg-current" />
          <span className="size-1.5 rounded-full bg-current" />
          <span className="size-1.5 rounded-full bg-current" />
        </div>
      ) : (
        <hr data-content-divider="line" className="border-0 border-t border-store-border" />
      );
    case "spacer":
      return <div aria-hidden="true" data-content-spacer={block.size ?? "md"} className={SPACER_CLASS[block.size ?? "md"]} />;
    case "callout":
      return <Callout block={block} labels={labels} />;
  }
}

export function CanvasContentBlocks({
  blocks,
  dir,
  viewport,
  labels,
  activeBlockId,
}: {
  blocks: ContentBlock[];
  dir: "ltr" | "rtl";
  viewport: Viewport;
  labels: CanvasContentLabels;
  /** The block the editor has selected; ringed and kept in view. */
  activeBlockId?: string | null;
}) {
  const drawn = blocks.filter(blockHasContent);
  if (drawn.length === 0) {
    return (
      <section data-content-blocks-empty="" className="rounded-store border border-dashed border-store-border-strong bg-store-surface px-4 py-5">
        <p className="text-xs text-store-muted-foreground">{labels.empty}</p>
      </section>
    );
  }
  let pictures = 0;
  const numberOf = (block: LeafBlock) => (block.kind === "image" ? ++pictures : 0);
  return (
    <section data-content-blocks="" data-vp={viewport} dir={dir} className="min-w-0 max-w-3xl space-y-3 break-words">
      {drawn.map((block) =>
        block.kind === "columns" ? (
          <Selectable key={block.id} id={block.id} selected={block.id === activeBlockId}>
            <div data-content-columns="" className="grid min-w-0 gap-6">
              {block.columns.map((column, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: a column is its position
                <div key={index} data-content-column="" className="min-w-0 space-y-3">
                  {column.filter(blockHasContent).map((leaf) => (
                    <Selectable key={leaf.id} id={leaf.id} selected={leaf.id === activeBlockId}>
                      <Leaf block={leaf} labels={labels} number={numberOf(leaf)} />
                    </Selectable>
                  ))}
                </div>
              ))}
            </div>
          </Selectable>
        ) : (
          <Selectable key={block.id} id={block.id} selected={block.id === activeBlockId}>
            <Leaf block={block} labels={labels} number={numberOf(block)} />
          </Selectable>
        ),
      )}
    </section>
  );
}
