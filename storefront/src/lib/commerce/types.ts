/**
 * Wire types for the AWJ Store public catalog API (`store/v1`). These are
 * AWJ-owned — deliberately NOT re-exported `@spree/sdk` types (see
 * AWJ_SPREE_TECHNICAL_FIT_AUDIT.md §5's warning that a "thin pass-through"
 * of SDK types makes later replacement hard). `mappers.ts` translates
 * these into the Spree-shaped view models the existing UI expects.
 */

export interface AwjMoney {
  amount_minor: number;
  currency: string;
}

export interface AwjProductCategoryRef {
  id: string;
  name: string;
}

export interface AwjProductMedia {
  id: string;
  url: string;
  alt: string | null;
  position: number;
}

export interface AwjProduct {
  id: string;
  name: string;
  name_en: string | null;
  description: string | null;
  sku: string | null;
  category: AwjProductCategoryRef | null;
  price: AwjMoney;
  /** null = availability unknown (channel has no fulfillment policy configured). */
  in_stock: boolean | null;
  thumbnail_url: string | null;
  media?: AwjProductMedia[];
  created_at: string | null;
  updated_at: string | null;
}

export interface AwjCategoryRef {
  id: string;
  name: string;
}

export interface AwjCategory {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  parent_id: string | null;
  children?: AwjCategory[];
  ancestors?: AwjCategoryRef[];
}

export interface AwjPagination {
  page: number;
  per_page: number;
  total: number;
  last_page: number;
  has_more: boolean;
}

export interface AwjListResponse<T> {
  data: T[];
  meta: { request_id: string; pagination: AwjPagination };
}

export interface AwjResourceResponse<T> {
  data: T;
  meta: { request_id: string };
}
