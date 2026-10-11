/**
 * CUST-HV V9d-2 (V0 §14.2) — how a product / offer shelf lays its cards out. Two merchant choices, both optional:
 *
 *  - `layout`: `grid` or `rail`. Absent = the theme's own form (a grid in Modern, a rail in Market), so existing stores are unchanged;
 *    an explicit value wins in either theme.
 *  - `columns`: 2, 3 or 4 on wide screens. Absent = today's `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4` (a rail: 2 / 3 / 5 per view).
 *    Phones always show two (the storefront's locked two-column product browsing).
 *
 * Class strings are literal so Tailwind sees them; the inputs are closed lists (the normaliser guarantees it), never merchant text.
 */
import type {
  ShelfColumns,
  ShelfLayout,
} from "@/lib/presentation/section-design";

export type { ShelfColumns, ShelfLayout };

export function shelfForm(
  layout: ShelfLayout | undefined,
  isMarket: boolean,
): ShelfLayout {
  return layout ?? (isMarket ? "rail" : "grid");
}

const GRID: Record<ShelfColumns | "auto", string> = {
  auto: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4",
  2: "grid-cols-2",
  3: "grid-cols-2 sm:grid-cols-3",
  4: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4",
};

export function shelfGridClass(columns: ShelfColumns | undefined): string {
  return GRID[columns ?? "auto"];
}

export type RailBreakpoints = Record<
  number,
  { slidesPerView: number; spaceBetween: number }
>;

/** The slides per view of a rail: phones always 2; tablets and desktops follow `columns` (absent = today's 3 / 5). */
export function shelfRailBreakpoints(
  columns: ShelfColumns | undefined,
): RailBreakpoints {
  if (columns === 2)
    return {
      640: { slidesPerView: 2, spaceBetween: 16 },
      1024: { slidesPerView: 2, spaceBetween: 20 },
    };
  if (columns === 3)
    return {
      640: { slidesPerView: 3, spaceBetween: 16 },
      1024: { slidesPerView: 3, spaceBetween: 20 },
    };
  if (columns === 4)
    return {
      640: { slidesPerView: 3, spaceBetween: 16 },
      1024: { slidesPerView: 4, spaceBetween: 20 },
    };
  return {
    640: { slidesPerView: 3, spaceBetween: 16 },
    1024: { slidesPerView: 5, spaceBetween: 20 },
  };
}
