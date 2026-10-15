import { getLocale } from "next-intl/server";
import type {
  FacetValueVisual,
  FacetVisualDefaults,
} from "@/lib/presentation/facet-visual";
import type { ShelfSource } from "@/lib/presentation/section-content";
import { storefrontFetch } from "./config";
import {
  type ListingFacetImageSource,
  parseListingFacets,
} from "./listing-facets";
import { mapAwjProductToViewModel } from "./mappers";
import type {
  AwjListResponse,
  AwjPagination,
  AwjProduct,
  StoreProduct,
} from "./types";

/**
 * FLOWERS-H9b / ADR-21 — live reads behind the data-backed home sections
 * (`productShelf`, `discovery`, `deliveryPromise`). The presentation document
 * stores only references and editorial text; everything below is read fresh
 * from the public `store/v1` API, host-resolved like every other read. A
 * failed or empty read means "no data" — callers omit the section; nothing is
 * ever invented.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

// ── productShelf ────────────────────────────────────────────────────────

export interface ShelfQuery {
  source?: ShelfSource;
  deliverToday: boolean;
  limit: number;
}

/** The listing deep-link equivalent of a shelf (see `shelfListingParams`). */
export function shelfListingParams(
  shelf: Pick<ShelfQuery, "source" | "deliverToday">,
): Record<string, string> {
  const params: Record<string, string> = {};
  if (shelf.source?.kind === "collection") {
    params.collection = shelf.source.slug;
  } else if (shelf.source?.kind === "facet") {
    params[`facet[${shelf.source.key}]`] = shelf.source.value;
  }
  if (shelf.deliverToday) params.deliver_today = "true";
  return params;
}

/**
 * Products for a shelf, in the API's own order (a collection's merchant order,
 * otherwise the default list order). `deliver_today` is time-sensitive — it
 * must reflect stock, cut-off and capacity *now* — so it bypasses any fetch
 * cache.
 */
export async function fetchShelfProducts(
  shelf: ShelfQuery,
): Promise<StoreProduct[]> {
  const response = await storefrontFetch<AwjListResponse<AwjProduct>>(
    "products",
    { per_page: shelf.limit, ...shelfListingParams(shelf) },
    shelf.deliverToday ? { cache: "no-store" } : undefined,
  );
  const locale = await getLocale();
  return response.data.map((product) =>
    mapAwjProductToViewModel(product, locale),
  );
}

// ── discovery ───────────────────────────────────────────────────────────

export interface DiscoveryOption {
  /** facet value slug, or the brand id. */
  value: string;
  name: string;
  count: number;
  /**
   * AWJ-VD-H1 / VD-4b — the value's own visual document (normalized, not resolved; absent = none), exactly as
   * `parseListingFacets` returns it. Its `image`, if any, has `imageSources`: same-origin proxy paths only. Brands
   * carry neither (the brand axis has no visual identity).
   */
  visual?: FacetValueVisual;
  imageSources?: ListingFacetImageSource[];
}

/** Which values to read: a merchant facet by key, or the built-in brands. */
export type DiscoverySelector =
  | { axis: "facet"; dimension: string }
  | { axis: "brand" };

export interface DiscoveryValues {
  /** The facet's display name; empty for brands (the caller supplies a title). */
  name: string;
  options: DiscoveryOption[];
  /** The facet-level defaults its values inherit (VD-1a chain). Absent for brands and for a facet without any. */
  defaults?: FacetVisualDefaults;
}

type AwjBrandMeta = { id: string; name: string; count: number };

/**
 * An option is only offered when the listing can honour its link: the same
 * token shapes `parseListingContext` accepts (facet values are checked by
 * `parseListingFacets`, brands here). Otherwise the tile would open an
 * unfiltered list under a misleading label.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function pickName(
  name: string,
  nameEn: string | null | undefined,
  locale: string,
) {
  return locale.toLowerCase().startsWith("en") && nameEn ? nameEn : name;
}

/**
 * Values and counts for one facet dimension (or brands), read from the product
 * list `meta` — the single source the public API exposes for them. One
 * `per_page=1` request carries the whole meta; the products themselves are
 * ignored. Returns null when the dimension has no visible value.
 */
export async function fetchDiscoveryValues(
  selector: DiscoverySelector,
): Promise<DiscoveryValues | null> {
  const response = await storefrontFetch<{
    data: unknown[];
    meta: { pagination: AwjPagination; facets?: unknown; brands?: unknown };
  }>("products", { per_page: 1 });
  const locale = await getLocale();

  if (selector.axis === "brand") {
    const brands = Array.isArray(response.meta.brands)
      ? (response.meta.brands as unknown[])
      : [];
    const options = brands
      .filter(isRecord)
      .map((brand) => brand as unknown as AwjBrandMeta)
      .filter(
        (brand) =>
          typeof brand.id === "string" &&
          UUID.test(brand.id) &&
          typeof brand.name === "string" &&
          brand.name.trim() !== "" &&
          typeof brand.count === "number" &&
          brand.count > 0,
      )
      .map((brand) => ({
        value: brand.id,
        name: brand.name,
        count: brand.count,
      }));
    return options.length === 0 ? null : { name: "", options };
  }

  // One facet row through the shared listing parser (re-normalized documents, canonical proxy sources only, the
  // `count > 0` visibility rule). Selecting the row by key first keeps the parser's group cap from hiding the
  // chosen dimension; the first row with the key wins, as before.
  const row = (Array.isArray(response.meta.facets) ? response.meta.facets : [])
    .filter(isRecord)
    .find((candidate) => candidate.key === selector.dimension);
  if (!row) return null;
  const group = parseListingFacets({ facets: [row] }, locale).groups[0];
  if (!group) return null;

  const options = group.values
    .filter((value) => value.count > 0)
    .map(
      (value): DiscoveryOption => ({
        value: value.slug,
        name: value.name,
        count: value.count,
        ...(value.visual ? { visual: value.visual } : {}),
        ...(value.imageSources ? { imageSources: value.imageSources } : {}),
      }),
    );
  if (options.length === 0) return null;
  return {
    name: group.name,
    options,
    ...(group.visual?.defaults ? { defaults: group.visual.defaults } : {}),
  };
}

/** The listing deep-link query for one discovery option. */
export function discoveryListingParams(
  selector: DiscoverySelector,
  value: string,
): Record<string, string> {
  return selector.axis === "brand"
    ? { brand_id: value }
    : { [`facet[${selector.dimension}]`]: value };
}

// ── deliveryPromise ─────────────────────────────────────────────────────

export interface DeliveryEarliest {
  /** Calendar date `Y-m-d` in `timezone`. */
  date: string;
  /** `HH:MM`, wall clock in `timezone`. */
  startTime: string;
  endTime: string;
  label: string;
  timezone: string;
}

/**
 * The earliest selectable delivery window (`GET store/v1/delivery-schedule`).
 * null when scheduling is off or nothing is selectable. Always fresh: the
 * answer depends on the clock, cut-off, blocked dates and capacity.
 */
export async function fetchEarliestDelivery(): Promise<DeliveryEarliest | null> {
  const response = await storefrontFetch<{
    data: {
      enabled?: boolean;
      timezone?: string | null;
      earliest?: { date: string; slot_id: string } | null;
      dates?: {
        date: string;
        slots: {
          id: string;
          label: string;
          label_en?: string | null;
          start_time: string;
          end_time: string;
        }[];
      }[];
    };
  }>("delivery-schedule", { method: "delivery" }, { cache: "no-store" });
  const data = response.data;
  if (data?.enabled !== true || !data.earliest || !data.timezone) {
    return null;
  }
  const day = data.dates?.find((d) => d.date === data.earliest?.date);
  const slot = day?.slots.find((s) => s.id === data.earliest?.slot_id);
  if (!slot) return null;
  const locale = await getLocale();
  return {
    date: data.earliest.date,
    startTime: slot.start_time,
    endTime: slot.end_time,
    label: pickName(slot.label, slot.label_en, locale),
    timezone: data.timezone,
  };
}

/**
 * Whether the store offers delivery scheduling at all — gates the listing's
 * "Deliver today" filter (FLOWERS-H10): without scheduling the derived filter
 * can only return an empty list. Any failure reads as "not available".
 */
export async function fetchDeliveryScheduleEnabled(): Promise<boolean> {
  try {
    const response = await storefrontFetch<{ data?: { enabled?: boolean } }>(
      "delivery-schedule",
      { method: "delivery" },
    );
    return response.data?.enabled === true;
  } catch {
    return false;
  }
}
