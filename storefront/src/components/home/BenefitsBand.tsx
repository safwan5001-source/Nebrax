import { StoreIcon } from "@/components/ui/store-icon";
import type { BenefitsContent } from "@/lib/presentation/section-content";
import type { BenefitsLayout } from "@/lib/presentation/section-design";
import { cn } from "@/lib/utils";

/**
 * CUST-HV V9b (V0 §3.4) — the columns a benefits layout asks for. Phones are always one column and tablets two; only the
 * wide-screen count is the merchant's. Class strings are literal so Tailwind sees them; the key is a closed list (the
 * normaliser guarantees it), never merchant text.
 */
export const BENEFITS_GRID: Readonly<Record<BenefitsLayout | "auto", string>> =
  {
    auto: "sm:grid-cols-2 lg:grid-cols-3",
    flat: "sm:grid-cols-2 lg:grid-cols-3",
    "columns-2": "sm:grid-cols-2",
    "columns-3": "sm:grid-cols-2 lg:grid-cols-3",
    "columns-4": "sm:grid-cols-2 lg:grid-cols-4",
  };

export function BenefitsBand({
  content,
  headingId,
  title,
  designed = false,
  layout,
}: {
  content: BenefitsContent;
  headingId: string;
  title: string;
  /** A section design frame wraps this band: expose the block marker its rules address. */
  designed?: boolean;
  /** `flat` drops the card frame; `columns-N` fixes the wide-screen count; absent = cards in automatic columns. */
  layout?: BenefitsLayout;
}) {
  const flat = layout === "flat";
  return (
    <section
      aria-labelledby={headingId}
      data-section-block={designed ? "" : undefined}
      data-benefits={layout ?? "auto"}
    >
      <h2
        id={headingId}
        className="text-base font-extrabold text-store-foreground md:text-lg"
      >
        {title}
      </h2>
      <ul
        className={cn(
          "mt-4 grid min-w-0",
          flat ? "gap-x-6 gap-y-5" : "gap-3",
          BENEFITS_GRID[layout ?? "auto"],
        )}
      >
        {content.items
          .filter((item) => item.title || item.body)
          .map((item) => (
            <li
              key={item.id}
              data-benefit-item=""
              className={cn(
                "flex min-w-0 items-start gap-3 break-words",
                flat
                  ? null
                  : "rounded-store border border-store-border bg-store-surface px-4 py-4",
              )}
            >
              {item.icon ? (
                <span
                  data-benefit-icon=""
                  className="flex size-10 shrink-0 items-center justify-center rounded-store border border-store-border text-store-foreground"
                >
                  <StoreIcon name={item.icon} className="size-5" />
                </span>
              ) : null}
              <div className="min-w-0 flex-1">
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
              </div>
            </li>
          ))}
      </ul>
    </section>
  );
}
