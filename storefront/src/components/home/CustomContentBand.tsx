import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { StoreIcon } from "@/components/ui/store-icon";
import { destination } from "@/lib/home/destination";
import type {
  HeadingBlock,
  ParagraphBlock,
} from "@/lib/presentation/content-blocks";
import type {
  ColumnsView,
  ImageView,
  ViewBlock,
  ViewLeaf,
} from "@/lib/presentation/content-blocks-resolve";
import { pictureData } from "@/lib/presentation/gallery-resolve";
import type { CustomContent } from "@/lib/presentation/section-content";
import type { ThemePresetId } from "@/lib/presentation/tokens";
import { cn } from "@/lib/utils";
import { BannerCtaLink } from "./BannerBand";

type TextBlock = HeadingBlock | ParagraphBlock;

interface ContentGroup {
  /** `null` for paragraphs authored before any heading — rendered plainly,
   * never folded into a disclosure, since there is no question for them to
   * answer. */
  heading: HeadingBlock | null;
  body: ParagraphBlock[];
}

/**
 * Groups a flat authored block list into heading-led sections: each heading
 * starts a new group, and the paragraphs that follow it (until the next
 * heading) become that group's body. This is the same shape a merchant
 * already produces when authoring FAQ-style content one question/answer pair
 * at a time — nothing new is asked of them, and no text is invented or
 * reordered.
 */
function groupBlocks(blocks: TextBlock[]): ContentGroup[] {
  const groups: ContentGroup[] = [];
  let current: ContentGroup | null = null;
  for (const block of blocks) {
    if (block.kind === "heading") {
      current = { heading: block, body: [] };
      groups.push(current);
    } else if (current) {
      current.body.push(block);
    } else {
      groups.push({ heading: null, body: [block] });
    }
  }
  return groups;
}

export interface ContentLabels {
  note: string;
  success: string;
  warning: string;
}

const ALIGN_CLASS = { center: "text-center", end: "text-end" } as const;
const SPACER_CLASS = { sm: "h-4", md: "h-8", lg: "h-14" } as const;
const CALLOUT_ACCENT = {
  info: "border-s-store-primary",
  success: "border-s-store-success",
  warning: "border-s-store-warning",
} as const;

function Picture({ block, sizes }: { block: ImageView; sizes: string }) {
  const data = pictureData(block.media);
  return (
    <picture>
      {data.webp ? (
        <source type="image/webp" srcSet={data.webp} sizes={sizes} />
      ) : null}
      <img
        src={data.fallback}
        srcSet={data.jpg || undefined}
        sizes={sizes}
        width={data.width}
        height={data.height}
        alt={block.alt}
        loading="lazy"
        decoding="async"
        className="h-auto w-full rounded-store"
      />
    </picture>
  );
}

function ImageBlockView({
  block,
  basePath,
  sizes,
}: {
  block: ImageView;
  basePath: string;
  sizes: string;
}) {
  const href = block.link ? destination(basePath, block.link) : null;
  const picture = <Picture block={block} sizes={sizes} />;
  return (
    <figure data-content-image="" className="min-w-0">
      {href ? (
        href.startsWith("https://") ? (
          <a
            href={href}
            rel="noopener noreferrer"
            className="block rounded-store focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            {picture}
          </a>
        ) : (
          <Link
            href={href}
            className="block rounded-store focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            {picture}
          </Link>
        )
      ) : (
        picture
      )}
      {block.caption ? (
        <figcaption className="mt-2 break-words text-xs leading-relaxed text-store-muted-foreground">
          {block.caption}
        </figcaption>
      ) : null}
    </figure>
  );
}

function Leaf({
  block,
  domId,
  basePath,
  labels,
  sizes,
}: {
  block: ViewLeaf;
  domId: (id: string) => string;
  basePath: string;
  labels?: ContentLabels;
  sizes: string;
}) {
  switch (block.kind) {
    case "heading": {
      const className = cn(
        "break-words font-extrabold text-store-foreground",
        block.level === 3 ? "text-base md:text-lg" : "text-lg md:text-xl",
        block.align && ALIGN_CLASS[block.align],
      );
      return block.level === 3 ? (
        <h3 id={domId(block.id)} className={className}>
          {block.text}
        </h3>
      ) : (
        <h2 id={domId(block.id)} className={className}>
          {block.text}
        </h2>
      );
    }
    case "paragraph":
      return (
        <p
          className={cn(
            "whitespace-pre-line break-words text-sm leading-relaxed text-store-muted-foreground",
            block.align && ALIGN_CLASS[block.align],
          )}
        >
          {block.text}
        </p>
      );
    case "image":
      return <ImageBlockView block={block} basePath={basePath} sizes={sizes} />;
    case "button": {
      const href = destination(basePath, block.href);
      if (!href) return null;
      return (
        <div data-content-button="">
          <BannerCtaLink
            cta={{
              label: block.label.trim(),
              href,
              style: block.style,
              colour: undefined,
            }}
            index={0}
          />
        </div>
      );
    }
    case "divider":
      return block.style === "dots" ? (
        <div
          role="presentation"
          aria-hidden="true"
          data-content-divider="dots"
          className="flex justify-center gap-2 py-1 text-store-border"
        >
          <span className="size-1.5 rounded-full bg-current" />
          <span className="size-1.5 rounded-full bg-current" />
          <span className="size-1.5 rounded-full bg-current" />
        </div>
      ) : (
        <hr
          data-content-divider="line"
          className="border-0 border-t border-store-border"
        />
      );
    case "spacer":
      return (
        <div
          aria-hidden="true"
          data-content-spacer={block.size ?? "md"}
          className={SPACER_CLASS[block.size ?? "md"]}
        />
      );
    case "callout": {
      const tone = block.tone ?? "info";
      const toneLabel = labels?.[tone === "info" ? "note" : tone];
      return (
        <aside
          data-content-callout={tone}
          className={cn(
            "flex min-w-0 items-start gap-3 break-words rounded-store border border-store-border border-s-4 bg-store-surface px-4 py-3",
            CALLOUT_ACCENT[tone],
          )}
        >
          {block.icon ? (
            <StoreIcon
              name={block.icon}
              className="mt-0.5 size-5 text-store-foreground"
            />
          ) : null}
          <p className="min-w-0 flex-1 whitespace-pre-line text-sm leading-relaxed text-store-foreground">
            {toneLabel ? <span className="sr-only">{toneLabel}: </span> : null}
            {block.text}
          </p>
        </aside>
      );
    }
    default:
      return null;
  }
}

function Columns({
  block,
  ...rest
}: {
  block: ColumnsView;
  domId: (id: string) => string;
  basePath: string;
  labels?: ContentLabels;
}) {
  return (
    <div data-content-columns="" className="grid min-w-0 gap-6 md:grid-cols-2">
      {block.columns.map((column, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: a column is its position
          key={index}
          data-content-column=""
          className="min-w-0 space-y-3"
        >
          {column.map((leaf) => (
            <Leaf
              key={leaf.id}
              block={leaf}
              sizes="(min-width: 768px) 24rem, 100vw"
              {...rest}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function CustomContentBand({
  content,
  sectionId,
  themePreset,
  view,
  basePath = "",
  labels,
}: {
  content: CustomContent;
  sectionId: string;
  /** See `CategoriesSection`'s identical prop doc for why this is explicit. */
  themePreset?: ThemePresetId;
  /** CUST-HV V9c-1 — the resolved blocks (images joined to their pictures, empties dropped). Absent ⇒ text blocks only. */
  view?: ViewBlock[];
  basePath?: string;
  labels?: ContentLabels;
}) {
  const textBlocks = content.blocks.filter(
    (block): block is TextBlock =>
      (block.kind === "heading" || block.kind === "paragraph") &&
      block.text.trim() !== "",
  );
  const domId = (id: string) => `${sectionId}-${id}`;
  const textOnly = content.blocks.every(
    (block) => block.kind === "heading" || block.kind === "paragraph",
  );

  if (textOnly) return <TextBand {...{ textBlocks, sectionId, themePreset }} />;

  const blocks = view ?? [];
  if (blocks.length === 0) return null;
  const firstHeading = blocks
    .flatMap((block) =>
      block.kind === "columns" ? block.columns.flat() : [block],
    )
    .find((block) => block.kind === "heading");
  return (
    <section
      aria-labelledby={firstHeading ? domId(firstHeading.id) : undefined}
      data-content-blocks=""
      className="max-w-3xl min-w-0 space-y-3 break-words"
    >
      {blocks.map((block) =>
        block.kind === "columns" ? (
          <Columns
            key={block.id}
            block={block}
            domId={domId}
            basePath={basePath}
            labels={labels}
          />
        ) : (
          <Leaf
            key={block.id}
            block={block}
            domId={domId}
            basePath={basePath}
            labels={labels}
            sizes="(min-width: 768px) 48rem, 100vw"
          />
        ),
      )}
    </section>
  );
}

/**
 * The original heading / paragraph rendering — byte-for-byte what a text-only section always drew, including the FAQ
 * accordion of the Market preset. A section with any other block kind takes the general path above.
 */
function TextBand({
  textBlocks,
  sectionId,
  themePreset,
}: {
  textBlocks: TextBlock[];
  sectionId: string;
  themePreset?: ThemePresetId;
}) {
  const blocks = textBlocks;
  const domId = (id: string) => `${sectionId}-${id}`;
  const labelledBy = blocks.find((block) => block.kind === "heading")?.id;
  if (blocks.length === 0) return null;

  const groups = groupBlocks(blocks);
  const headedGroups = groups.filter((group) => group.heading !== null);
  /*
   * AWJ Market's benchmark presents multi-question content (FAQ) as an
   * accordion — see the coverage matrix. A disclosure only reads as an FAQ
   * once there is more than one question to disclose; a single heading with
   * supporting paragraphs is ordinary prose (an "about us" block, say), and
   * folding it away by default would hide a merchant's only content behind
   * an extra click for no benefit. Modern is unchanged either way — this
   * never turns into a disclosure outside Market.
   */
  const useAccordion = themePreset === "awj-market" && headedGroups.length >= 2;

  if (!useAccordion) {
    return (
      <section
        aria-labelledby={labelledBy ? domId(labelledBy) : undefined}
        className="max-w-3xl min-w-0 space-y-3 break-words"
      >
        {blocks.map((block) =>
          block.kind === "heading" ? (
            <h2
              key={block.id}
              id={domId(block.id)}
              className={cn(
                "break-words text-lg font-extrabold text-store-foreground md:text-xl",
                block.level === 3 && "text-base md:text-lg",
                block.align && ALIGN_CLASS[block.align],
              )}
            >
              {block.text}
            </h2>
          ) : (
            <p
              key={block.id}
              className={cn(
                "whitespace-pre-line break-words text-sm leading-relaxed text-store-muted-foreground",
                block.align && ALIGN_CLASS[block.align],
              )}
            >
              {block.text}
            </p>
          ),
        )}
      </section>
    );
  }

  return (
    <section
      aria-labelledby={labelledBy ? domId(labelledBy) : undefined}
      className="max-w-3xl min-w-0 space-y-2 break-words"
    >
      {groups.map((group, index) =>
        group.heading ? (
          <details
            key={group.heading.id}
            className="group rounded-store border border-store-border bg-store-surface px-4 open:pb-4"
          >
            <summary
              id={domId(group.heading.id)}
              className="flex cursor-pointer list-none items-center justify-between gap-3 py-3.5 text-sm font-bold text-store-foreground marker:content-none"
            >
              <span className="break-words">{group.heading.text}</span>
              <ChevronDown
                className="size-4 shrink-0 text-store-muted-foreground transition-transform group-open:rotate-180"
                aria-hidden="true"
              />
            </summary>
            <div className="space-y-2">
              {group.body.map((block) => (
                <p
                  key={block.id}
                  className="whitespace-pre-line break-words text-sm leading-relaxed text-store-muted-foreground"
                >
                  {block.text}
                </p>
              ))}
            </div>
          </details>
        ) : (
          // Preamble before the first heading (rare, but authorable) —
          // plain paragraphs, not part of any disclosure.
          <div key={`preamble-${index}`} className="space-y-2">
            {group.body.map((block) => (
              <p
                key={block.id}
                className="whitespace-pre-line break-words text-sm leading-relaxed text-store-muted-foreground"
              >
                {block.text}
              </p>
            ))}
          </div>
        ),
      )}
    </section>
  );
}
