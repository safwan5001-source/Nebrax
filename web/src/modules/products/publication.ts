import { api } from '@/lib/api';
import { COMMERCE_STORE_ADMIN_LIST_PATH } from '@/modules/commerce-workspace/stores';

export type ProductPublicationStore = {
  id: string;
  name: string;
  isPublished: boolean;
};

type ProductPublicationPayload = {
  data: {
    stores: Array<{
      id: string;
      name: string;
      is_published: boolean;
    }>;
  };
};

type AvailableStoresPayload = {
  data: {
    stores: Array<{
      id: string;
      name: string;
    }>;
  };
};

export function productPublicationPath(productId: string): string {
  return `/commerce/workspace/products/${encodeURIComponent(productId)}/publication`;
}

/** Loads the publication overlay for an existing tenant-owned product. */
export async function loadProductPublication(productId: string): Promise<ProductPublicationStore[]> {
  const payload = await api<ProductPublicationPayload>(productPublicationPath(productId));
  return mapPublicationStores(payload.data.stores);
}

/** Loads tenant-authorized choices before a new product has an id. */
export async function loadAvailableProductStores(): Promise<ProductPublicationStore[]> {
  const payload = await api<AvailableStoresPayload>(COMMERCE_STORE_ADMIN_LIST_PATH);
  return payload.data.stores.map((store) => ({
    id: store.id,
    name: store.name,
    isPublished: false,
  }));
}

/** CommerceListing.is_published remains the sole publication source of truth. */
export async function replaceProductPublication(productId: string, storefrontIds: string[]): Promise<ProductPublicationStore[]> {
  const payload = await api<ProductPublicationPayload>(productPublicationPath(productId), {
    method: 'PUT',
    body: { storefront_ids: storefrontIds },
  });
  return mapPublicationStores(payload.data.stores);
}

function mapPublicationStores(stores: ProductPublicationPayload['data']['stores']): ProductPublicationStore[] {
  return stores.map((store) => ({
    id: store.id,
    name: store.name,
    isPublished: store.is_published === true,
  }));
}

// ── COM-CATALOG-1 — Product Publication Workspace list ─────────────────────

export type PublicationStatusFilter = 'all' | 'published' | 'unpublished';

export type ProductPublicationListItem = {
  id: string;
  sku: string | null;
  name: string;
  nameEn: string | null;
  isActive: boolean;
  isPublished: boolean;
  stores: ProductPublicationStore[];
};

export type ProductPublicationListPage = {
  items: ProductPublicationListItem[];
  meta: {
    currentPage: number;
    lastPage: number;
    perPage: number;
    total: number;
  };
};

type ProductPublicationListPayload = {
  data: Array<{
    id: string;
    sku: string | null;
    name: string;
    name_en: string | null;
    is_active: boolean;
    is_published: boolean;
    stores: Array<{ id: string; name: string; is_published: boolean }>;
  }>;
  meta: {
    current_page: number;
    last_page: number;
    per_page: number;
    total: number;
  };
};

export function productPublicationListPath(): string {
  return '/commerce/workspace/products/publication';
}

/**
 * قائمة مساحة عمل نشر المنتجات — البحث والفلترة والتقسيم خادمية، وحالة النشر
 * تقرأ من CommerceListing.is_published فقط (نفس بوابة المتجر العام). لا
 * يُرسل العميل أي tenant_id، ولا يُرسل storefront_id إلا كاختيار داخل قائمة
 * المتاجر التي رخّصها الخادم نفسه.
 */
export async function loadProductPublicationList(params: {
  search?: string;
  status?: PublicationStatusFilter;
  storefrontId?: string;
  page?: number;
  perPage?: number;
}): Promise<ProductPublicationListPage> {
  const query = new URLSearchParams();
  if (params.search?.trim()) query.set('search', params.search.trim());
  if (params.status && params.status !== 'all') query.set('status', params.status);
  if (params.storefrontId) query.set('storefront_id', params.storefrontId);
  query.set('page', String(params.page ?? 1));
  query.set('per_page', String(params.perPage ?? 25));

  const payload = await api<ProductPublicationListPayload>(`${productPublicationListPath()}?${query.toString()}`);

  return {
    items: payload.data.map((item) => ({
      id: item.id,
      sku: item.sku ?? null,
      name: item.name,
      nameEn: item.name_en ?? null,
      isActive: item.is_active === true,
      isPublished: item.is_published === true,
      stores: mapPublicationStores(item.stores),
    })),
    meta: {
      currentPage: payload.meta.current_page,
      lastPage: payload.meta.last_page,
      perPage: payload.meta.per_page,
      total: payload.meta.total,
    },
  };
}
