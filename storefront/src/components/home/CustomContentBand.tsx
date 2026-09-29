import { ChevronDown } from "lucide-react";
import type {
  CustomBlock,
  CustomContent,
} from "@/lib/presentation/section-content";
import type { ThemePresetId } from "@/lib/presentation/tokens";

interface ContentGroup {
  /** `null` for paragraphs authored before any heading — rendered plainly,
   * never folded into a disclosure, since there is no question for them to
   * answer. */
  heading: CustomBlock | null;
  body: CustomBlock[];
}

/**
 * Groups a flat authored block list into heading-led sections: each heading
 * starts a new group, and the paragraphs that follow it (until the next
 * heading) become that group's body. This is the same shape a merchant
 * already produces when authoring FAQ-style content one question/answer pair
 * at a time — nothing new is asked of them, and no text is invented or
 * reordered.
 */
function groupBlocks(blocks: CustomBlock[]): ContentGroup[] {
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

export function CustomContentBand({
  content,
  sectionId,
  themePreset,
}: {
  content: CustomContent;
  sectionId: string;
  /** See `CategoriesSection`'s identical prop doc for why this is explicit. */
  themePreset?: ThemePresetId;
}) {
  const blocks = content.blocks.filter((block) => block.text.trim());
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
              className="break-words text-lg font-extrabold text-store-foreground md:text-xl"
            >
              {block.text}
            </h2>
          ) : (
            <p
              key={block.id}
              className="break-words text-sm leading-relaxed text-store-muted-foreground"
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
                  className="break-words text-sm leading-relaxed text-store-muted-foreground"
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
                className="break-words text-sm leading-relaxed text-store-muted-foreground"
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
