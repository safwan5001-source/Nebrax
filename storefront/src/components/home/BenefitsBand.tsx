import type { BenefitsContent } from "@/lib/presentation/section-content";

export function BenefitsBand({
  content,
  headingId,
  title,
}: {
  content: BenefitsContent;
  headingId: string;
  title: string;
}) {
  return (
    <section aria-labelledby={headingId}>
      <h2
        id={headingId}
        className="text-base font-extrabold text-store-foreground md:text-lg"
      >
        {title}
      </h2>
      <ul className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {content.items
          .filter((item) => item.title || item.body)
          .map((item) => (
            <li
              key={item.id}
              className="min-w-0 break-words rounded-store border border-store-border bg-store-surface px-4 py-4"
            >
              {item.title ? (
                <p className="break-words text-sm font-bold text-store-foreground">
                  {item.title}
                </p>
              ) : null}
              {item.body ? (
                <p className="mt-1 break-words text-sm text-store-muted-foreground">
                  {item.body}
                </p>
              ) : null}
            </li>
          ))}
      </ul>
    </section>
  );
}
