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
