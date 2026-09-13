import { useCallback, useEffect, useState } from 'react';
import {
  loadAvailableProductStores,
  loadProductPublication,
  type ProductPublicationStore,
} from './publication';

export type ProductPublicationStatus = 'loading' | 'ready' | 'empty' | 'error';

export function useProductPublication(productId?: string, enabled = true) {
  const [status, setStatus] = useState<ProductPublicationStatus>('loading');
  const [stores, setStores] = useState<ProductPublicationStore[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const reload = useCallback(async () => {
    if (!enabled) return;
    setStatus('loading');
    try {
      const available = productId
        ? await loadProductPublication(productId)
        : await loadAvailableProductStores();
      setStores(available);
      setSelectedIds(available.filter((store) => store.isPublished).map((store) => store.id));
      setStatus(available.length === 0 ? 'empty' : 'ready');
    } catch {
      // Keep publication fail-closed: failed reads never become an empty PUT.
      setStores([]);
      setSelectedIds([]);
      setStatus('error');
    }
  }, [enabled, productId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { status, stores, selectedIds, setSelectedIds, reload };
}
