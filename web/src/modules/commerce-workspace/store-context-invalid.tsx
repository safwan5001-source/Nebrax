'use client';

import { useLocale } from 'next-intl';
import { Store } from 'lucide-react';
import { EmptyState } from '@/components/nebrax';
import { Select } from '@/components/ui/select';
import { commerceWorkspaceMessage } from './messages';
import { useCommerceStoreContext } from './store-context';

/**
 * AWJ-STORE-CTX-1 — يظهر حين يُطلب متجر صراحةً (رابط/جلسة التبويب) ولا يوجد في قائمة المستأجر. لا يُفتح متجر
 * بديل تلقائياً: الصفحة بلا متجر نشط (فلا قراءة ولا حفظ) حتى يختار المستخدم من هذه القائمة.
 */
export function StoreContextInvalidNotice() {
  const locale = useLocale();
  const t = (key: Parameters<typeof commerceWorkspaceMessage>[1]) => commerceWorkspaceMessage(locale, key);
  const { catalog, setSelectedStoreId } = useCommerceStoreContext();
  const stores = catalog.status === 'ready' ? catalog.stores : [];

  return (
    <div data-store-context-invalid="">
      <EmptyState
        icon={Store}
        title={t('storeContextInvalidTitle')}
        description={t('storeContextInvalidDescription')}
        action={stores.length > 0 ? (
          <Select
            aria-label={t('storeSelectorChoose')}
            value=""
            onChange={(event) => {
              if (event.target.value) setSelectedStoreId(event.target.value);
            }}
          >
            <option value="" disabled>{t('storeSelectorChoose')}</option>
            {stores.map((store) => (
              <option key={store.id} value={store.id}>{store.name}</option>
            ))}
          </Select>
        ) : null}
      />
    </div>
  );
}
