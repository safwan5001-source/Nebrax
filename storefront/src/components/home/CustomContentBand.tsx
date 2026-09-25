import type { CustomContent } from "@/lib/presentation/section-content";

export function CustomContentBand({ content }: { content: CustomContent }) {
  const blocks = content.blocks.filter((block) => block.text.trim());
  const labelledBy = blocks.find((block) => block.kind === "heading")?.id;
  if (blocks.length === 0) return null;
  return (
    <section aria-labelledby={labelledBy} className="max-w-3xl space-y-3">
      {blocks.map((block) =>
        block.kind === "heading" ? (
          <h2
            key={block.id}
            id={block.id}
            className="text-lg font-extrabold text-store-foreground md:text-xl"
          >
            {block.text}
          </h2>
        ) : (
          <p
            key={block.id}
            className="text-sm leading-relaxed text-store-muted-foreground"
          >
            {block.text}
          </p>
        ),
      )}
    </section>
  );
}
