import Link from "next/link";
import type { ReactNode } from "react";

interface SectionHeadingProps {
  id: string;
  title: string;
  /** Optional supporting line. Hidden on phones, where the measure is scarce. */
  description?: string | null;
  action?: { href: string; label: string } | null;
  children?: ReactNode;
  /**
   * CUST-HV V9d-3 — the merchant chose not to show the title: it stays in the DOM, visually hidden, as the section's accessible name
   * (the `aria-labelledby` target), and only the action link remains visible, on the end edge.
   */
  hideTitle?: boolean;
}

/**
 * One heading treatment for every homepage block.
 *
 * The rule bar carries the store's primary colour into the content area, which
 * is what keeps a stack of otherwise unstyled blocks reading as one page. It is
 * shared rather than repeated per section so a section added later inherits the
 * rhythm instead of inventing a new one.
 */
export function SectionHeading({
  id,
  title,
  description,
  action,
  hideTitle = false,
}: SectionHeadingProps) {
  if (hideTitle) {
    return (
      <div
        data-section-heading=""
        data-title-hidden=""
        className="flex items-start justify-end gap-4"
      >
        <h2 id={id} className="sr-only">
          {title}
        </h2>
        {action ? <HeadingAction action={action} /> : null}
      </div>
    );
  }
  return (
    <div
      data-section-heading=""
      className="flex items-start justify-between gap-4"
    >
      <div className="flex min-w-0 items-start gap-2">
        <span
          aria-hidden="true"
          data-heading-bar=""
          className="mt-1 h-4 w-1.5 shrink-0 rounded-full bg-store-primary md:mt-1.5 md:h-5"
        />
        <div className="min-w-0">
          <h2
            id={id}
            className="text-base font-extrabold leading-tight text-store-foreground md:text-lg"
          >
            {title}
          </h2>
          {description && (
            <p className="mt-0.5 hidden text-xs text-store-muted-foreground md:block">
              {description}
            </p>
          )}
        </div>
      </div>
      {action ? <HeadingAction action={action} /> : null}
    </div>
  );
}

function HeadingAction({
  action,
}: {
  action: { href: string; label: string };
}) {
  return (
    <Link
      href={action.href}
      className="mt-0.5 inline-flex shrink-0 items-center gap-1 text-xs font-bold text-store-primary transition-colors hover:text-store-primary-hover md:text-sm"
    >
      <span>{action.label}</span>
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        strokeWidth={2.5}
        className="size-3.5 stroke-current rtl:rotate-180"
      >
        <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </Link>
  );
}
