import { api } from '@/lib/api';

import type { ProductPublicationStore, PublicationStatusFilter } from '@/modules/products/publication';

/**
 * COM-CATALOG-2 — Category Publication Workspace.
 * ProductCategory remains the master data; CommerceCategoryListing.is_published
 * is the sole category publication source of truth (the same rows the public
 * storefront category gate reads) — fully independent from product publication.
 */

export type CategoryPublicationListItem = {
  id: string;
  name: string;
  parentId: string | null;
  parentName: string | null;
  isActive: boolean;
  isPublished: boolean;
  stores: ProductPublicationStore[];
};

export type CategoryPublicationListPage = {
  items: CategoryPublicationListItem[];
  meta: {
    currentPage: number;
    lastPage: number;
    perPage: number;
    total: number;
  };
};

type CategoryPublicationListPayload = {
  data: Array<{
    id: string;
    name: string;
    parent_id: string | null;
    parent_name: string | null;
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

type CategoryPublicationPayload = {
  data: {
    stores: Array<{
      id: string;
      name: string;
      is_published: boolean;
    }>;
  };
};

export function categoryPublicationListPath(): string {
  return '/commerce/workspace/categories/publication';
}

export function categoryPublicationPath(categoryId: string): string {
  return `/commerce/workspace/categories/${encodeURIComponent(categoryId)}/publication`;
}

/**
 * قائمة مساحة عمل نشر التصنيفات — البحث والفلترة والتقسيم خادمية، وحالة النشر
 * تقرأ من CommerceCategoryListing.is_published فقط. لا يُرسل العميل أي
 * tenant_id، ولا يُرسل storefront_id إلا كاختيار داخل قائمة المتاجر التي
 * رخّصها الخادم نفسه.
 */
export async function loadCategoryPublicationList(params: {
  search?: string;
  status?: PublicationStatusFilter;
  storefrontId?: string;
  page?: number;
  perPage?: number;
}): Promise<CategoryPublicationListPage> {
  const query = new URLSearchParams();
  if (params.search?.trim()) query.set('search', params.search.trim());
  if (params.status && params.status !== 'all') query.set('status', params.status);
  if (params.storefrontId) query.set('storefront_id', params.storefrontId);
  query.set('page', String(params.page ?? 1));
  query.set('per_page', String(params.perPage ?? 25));

  const payload = await api<CategoryPublicationListPayload>(`${categoryPublicationListPath()}?${query.toString()}`);

  return {
    items: payload.data.map((item) => ({
      id: item.id,
      name: item.name,
      parentId: item.parent_id ?? null,
      parentName: item.parent_name ?? null,
      isActive: item.is_active === true,
      isPublished: item.is_published === true,
      stores: item.stores.map((store) => ({
        id: store.id,
        name: store.name,
        isPublished: store.is_published === true,
      })),
    })),
    meta: {
      currentPage: payload.meta.current_page,
      lastPage: payload.meta.last_page,
      perPage: payload.meta.per_page,
      total: payload.meta.total,
    },
  };
}

/** CommerceCategoryListing.is_published remains the sole category publication source of truth. */
export async function replaceCategoryPublication(categoryId: string, storefrontIds: string[]): Promise<ProductPublicationStore[]> {
  const payload = await api<CategoryPublicationPayload>(categoryPublicationPath(categoryId), {
    method: 'PUT',
    body: { storefront_ids: storefrontIds },
  });
  return payload.data.stores.map((store) => ({
    id: store.id,
    name: store.name,
    isPublished: store.is_published === true,
  }));
}
