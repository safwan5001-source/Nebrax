import Link from "next/link";
import type { BannerContent } from "@/lib/presentation/section-content";

function destination(basePath: string, href: string): string | null {
  if (!href) return null;
  if (href.startsWith("https://")) return href;
  if (!href.startsWith("/")) return null;
  if (href === basePath || href.startsWith(`${basePath}/`)) return href;
  return `${basePath}${href}`;
}

export function BannerBand({
  content,
  basePath,
  headingId,
}: {
  content: BannerContent;
  basePath: string;
  headingId: string;
}) {
  const href = destination(basePath, content.ctaHref);
  const showCta = Boolean(href && content.ctaLabel);
  return (
    <section
      aria-labelledby={headingId}
      className="overflow-hidden rounded-store border border-store-border bg-store-surface"
    >
      <div className="flex min-w-0 flex-col gap-4 p-5 md:flex-row md:items-center md:p-8">
        {content.imageUrl ? (
          // biome-ignore lint/performance/noImgElement: merchant banner is a runtime https URL, not a static import
          <img
            src={content.imageUrl}
            alt=""
            className="h-36 w-full rounded-store object-cover md:h-40 md:w-56 md:shrink-0"
          />
        ) : null}
        <div className="min-w-0">
          {content.title ? (
            <h2
              id={headingId}
              className="break-words text-lg font-extrabold leading-tight text-store-foreground md:text-2xl"
            >
              {content.title}
            </h2>
          ) : (
            <h2 id={headingId} className="sr-only">
              {content.subtitle || content.ctaLabel}
            </h2>
          )}
          {content.subtitle ? (
            <p className="mt-2 max-w-2xl break-words text-sm text-store-muted-foreground">
              {content.subtitle}
            </p>
          ) : null}
          {showCta && href ? (
            href.startsWith("https://") ? (
              <a
                href={href}
                className="mt-4 inline-flex h-10 items-center rounded-store bg-store-primary px-4 text-sm font-bold text-store-primary-foreground"
              >
                {content.ctaLabel}
              </a>
            ) : (
              <Link
                href={href}
                className="mt-4 inline-flex h-10 items-center rounded-store bg-store-primary px-4 text-sm font-bold text-store-primary-foreground"
              >
                {content.ctaLabel}
              </Link>
            )
          ) : null}
        </div>
      </div>
    </section>
  );
}
