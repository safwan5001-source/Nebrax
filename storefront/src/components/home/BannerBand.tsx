import Link from "next/link";
import type { ReactNode } from "react";
import { destination } from "@/lib/home/destination";
import {
  type BannerContent,
  bannerCtasOf,
} from "@/lib/presentation/section-content";

export function BannerBand({
  content,
  basePath,
  headingId,
  designed = false,
  backdrop,
}: {
  content: BannerContent;
  basePath: string;
  headingId: string;
  /** A section design frame wraps this band: expose the content-box marker its rules address. */
  designed?: boolean;
  /** CUST-HV V6b-3 — the picture layer of a media background; absent ⇒ unchanged output. */
  backdrop?: ReactNode;
}) {
  // CUST-HV V6c-2 — `ctas` when authored, else the legacy pair (= ctas[0]). Only a complete button renders;
  // an incomplete draft (label without link, or the reverse) is skipped and never borrows another's link.
  const ctas = bannerCtasOf(content)
    .map((cta) => ({
      label: cta.label.trim(),
      href: destination(basePath, cta.href),
    }))
    .filter(
      (cta): cta is { label: string; href: string } =>
        cta.label !== "" && cta.href !== null,
    );
  const headingFallback =
    content.subtitle ||
    bannerCtasOf(content)
      .map((cta) => cta.label.trim())
      .find((label) => label !== "");
  return (
    <section
      aria-labelledby={headingId}
      className="overflow-hidden rounded-store border border-store-border bg-store-surface"
    >
      {backdrop}
      <div
        data-section-content={designed ? "" : undefined}
        className="flex min-w-0 flex-col gap-4 p-5 md:flex-row md:items-center md:p-8"
      >
        {content.imageUrl ? (
          // biome-ignore lint/performance/noImgElement: merchant banner is a runtime https URL, not a static import
          <img
            src={content.imageUrl}
            // Decorative (empty alt) until the merchant authors real alt
            // text — never a guessed or duplicated description.
            alt={content.imageAlt?.trim() || ""}
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
              {headingFallback}
            </h2>
          )}
          {content.subtitle ? (
            <p className="mt-2 max-w-2xl break-words text-sm text-store-muted-foreground">
              {content.subtitle}
            </p>
          ) : null}
          {ctas.length === 1 ? (
            <BannerCtaLink
              cta={ctas[0]}
              className="mt-4 inline-flex h-10 max-w-full items-center rounded-store bg-store-primary px-4 text-sm font-bold text-store-primary-foreground"
            />
          ) : ctas.length > 1 ? (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              {ctas.map((cta, index) => (
                <BannerCtaLink
                  key={`${index}-${cta.href}`}
                  cta={cta}
                  secondary={index > 0}
                  // The second button is an outline in the heading colour (not the brand colour), so it is
                  // legible on the section surface for exactly the reason the title is.
                  className={
                    index === 0
                      ? "inline-flex h-10 max-w-full items-center rounded-store bg-store-primary px-4 text-sm font-bold text-store-primary-foreground"
                      : "inline-flex h-10 max-w-full items-center rounded-store border-2 border-store-foreground/60 px-4 text-sm font-bold text-store-foreground"
                  }
                />
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

// The second button is the shared Button's outline variant as far as the global button tokens are concerned
// (size step, corner, weight and case follow the store's setting like every other button; its fill and colour
// stay its own). The first is the store's solid CTA, which the tokens already reach by its class.
const OUTLINE_BUTTON = {
  "data-slot": "button",
  "data-variant": "outline",
} as const;

function BannerCtaLink({
  cta,
  className,
  secondary = false,
}: {
  cta: { label: string; href: string };
  className: string;
  secondary?: boolean;
}) {
  const extra = secondary ? OUTLINE_BUTTON : {};
  return cta.href.startsWith("https://") ? (
    <a href={cta.href} className={className} {...extra}>
      <span className="min-w-0 truncate">{cta.label}</span>
    </a>
  ) : (
    <Link href={cta.href} className={className} {...extra}>
      <span className="min-w-0 truncate">{cta.label}</span>
    </Link>
  );
}
