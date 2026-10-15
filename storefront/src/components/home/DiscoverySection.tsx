import Link from "next/link";
import { getTranslations } from "next-intl/server";
import {
  type DiscoverySelector,
  discoveryListingParams,
  fetchDiscoveryValues,
} from "@/lib/commerce/data-sections";
import {
  buildDiscoveryItems,
  visibleDiscoveryOptions,
} from "@/lib/presentation/discovery-items";
import { resolveDiscoveryDisplay } from "@/lib/presentation/discovery-templates";
import type { DiscoveryContent } from "@/lib/presentation/section-content";
import { DiscoveryItems } from "./DiscoveryItems";

/**
 * FLOWERS-H9b / ADR-21 — the published "discovery" section ("Shop by occasion /
 * recipient / flower type / brand …").
 *
 * The document stores only the axis (a merchant facet key, or brands) and a display
 * style. The visible values and their counts are read live from the public
 * product list meta, so a merchant renaming a value or a value running out of
 * products is reflected immediately. A dimension with no visible value — or a
 * failed read — leaves no section.
 *
 * AWJ-VD-H1 / VD-4b: a document that chose a `layout` (or a `template`, which carries one) renders the visual
 * layouts in `DiscoveryItems`, each value's real visual resolved by the VD-1a chain. A document with neither is a
 * legacy one and keeps the `display` tiles / chips markup below exactly as before.
 */
export async function DiscoverySection({
  content,
  basePath,
  locale,
  headingId,
}: {
  content: DiscoveryContent;
  basePath: string;
  locale: string;
  headingId: string;
}) {
  const selector: DiscoverySelector | null =
    content.axis === "brand"
      ? { axis: "brand" }
      : content.dimension
        ? { axis: "facet", dimension: content.dimension }
        : null;
  if (!selector) return null;
  const values = await fetchDiscoveryValues(selector).catch((error) => {
    console.error("DiscoverySection: failed to load discovery values", error);
    return null;
  });
  if (!values) return null;

  const t = await getTranslations({
    locale: locale as Locale,
    namespace: "home",
  });
  const title =
    content.title ||
    (selector.axis === "brand"
      ? t("shopByBrand")
      : `${t("discoverBy")} ${values.name}`.trim());
  const display = resolveDiscoveryDisplay(content);
  // `valueSort` and `maxItems` default to the legacy behaviour (the API's order, 12): a legacy document is unchanged.
  const options = visibleDiscoveryOptions(values.options, display);

  const href = (value: string) => {
    const query = new URLSearchParams(
      discoveryListingParams(selector, value),
    ).toString();
    return `${basePath}/products?${query}`;
  };

  if (display.layout !== null) {
    const layoutDisplay = { ...display, layout: display.layout };
    const numbers = new Intl.NumberFormat(locale);
    return (
      <section aria-labelledby={headingId}>
        <h2
          id={headingId}
          className="text-base font-extrabold text-store-foreground md:text-lg"
        >
          {title}
        </h2>
        <DiscoveryItems
          layout={display.layout}
          display={layoutDisplay}
          items={buildDiscoveryItems(values, layoutDisplay)}
          hrefOf={href}
          idPrefix={headingId}
          formatCount={(count) => numbers.format(count)}
          describeCount={(count) => t("discoveryProductCount", { count })}
        />
      </section>
    );
  }

  return (
    <section aria-labelledby={headingId}>
      <h2
        id={headingId}
        className="text-base font-extrabold text-store-foreground md:text-lg"
      >
        {title}
      </h2>
      {content.display === "chips" ? (
        <ul className="mt-4 flex flex-wrap gap-2">
          {options.map((option) => (
            <li key={option.value}>
              <Link
                href={href(option.value)}
                className="inline-flex min-h-11 items-center rounded-full border border-store-border bg-store-surface px-4 text-sm font-bold text-store-foreground transition-colors hover:border-store-primary hover:text-store-primary"
              >
                {option.name}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 md:gap-4">
          {options.map((option) => (
            <li key={option.value} className="min-w-0">
              <Link
                href={href(option.value)}
                className="flex min-h-20 items-center justify-center rounded-store border border-store-border bg-store-surface px-3 py-4 text-center text-sm font-bold text-store-foreground transition-colors hover:border-store-primary hover:text-store-primary md:text-base"
              >
                <span className="min-w-0 break-words">{option.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
