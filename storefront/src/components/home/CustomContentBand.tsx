import type { CustomContent } from "@/lib/presentation/section-content";

export function CustomContentBand({
  content,
  sectionId,
}: {
  content: CustomContent;
  sectionId: string;
}) {
  const blocks = content.blocks.filter((block) => block.text.trim());
  const domId = (id: string) => `${sectionId}-${id}`;
  const labelledBy = blocks.find((block) => block.kind === "heading")?.id;
  if (blocks.length === 0) return null;
  return (
    <section
      aria-labelledby={labelledBy ? domId(labelledBy) : undefined}
      className="max-w-3xl space-y-3"
    >
      {blocks.map((block) =>
        block.kind === "heading" ? (
          <h2
            key={block.id}
            id={domId(block.id)}
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
