'use client';

import { useState } from 'react';
import { useLocale } from 'next-intl';
import { Store as StoreIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/nebrax';
import { currentUser } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import { commerceWorkspaceMessage } from '@/modules/commerce-workspace/messages';
import { useCommerceStoreContext } from '@/modules/commerce-workspace/store-context';
import { provisionCommerceStorefront, type CommerceStoreOption } from '@/modules/commerce-workspace/stores';
import { StoreSettingsDialog } from '@/modules/commerce-workspace/store-settings-dialog';

/**
 * COM-STORE-PROVISION-1 — شاشة «المتاجر»: تعرض الكتالوج الموثوق من
 * `CommerceStoreProvider`، وحين لا يوجد متجر بعد تعرض فعل التزويد الصريح
 * الوحيد المسموح به («إنشاء متجر إلكتروني»). لا تزويد تلقائي عند تحميل
 * الشاشة — الفعل يبدأ فقط بنقرة صريحة من مستخدم يملك `commerce.manage`.
 */
export default function CommerceStoresPage() {
  const locale = useLocale();
  const t = (key: Parameters<typeof commerceWorkspaceMessage>[1]) => commerceWorkspaceMessage(locale, key);
  const { catalog, refresh } = useCommerceStoreContext();
  const { error: showErrorToast, success: showSuccessToast } = useToast();
  const [creating, setCreating] = useState(false);
  const [settingsStore, setSettingsStore] = useState<CommerceStoreOption | null>(null);

  const user = currentUser();
  const canManage = hasPermission(user?.permissions, user?.role, 'commerce.manage');

  const handleCreate = async () => {
    if (creating) return; // يمنع إرسالاً مزدوجاً عرضياً (نقر متكرر أثناء الانتظار)
    setCreating(true);
    try {
      const result = await provisionCommerceStorefront();
      if (!result.ok) {
        showErrorToast(t('createStoreFailed'));
        return;
      }
      await refresh(result.store.id);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader eyebrow={t('title')} title={t('stores')} />

      {catalog.status === 'loading' ? <LoadingState variant="table" rows={3} /> : null}

      {catalog.status === 'error' || catalog.status === 'unavailable' ? (
        <ErrorState message={t('storeSelectorUnavailableHint')} />
      ) : null}

      {catalog.status === 'empty' ? (
        <EmptyState
          icon={StoreIcon}
          title={t('noStoreYetTitle')}
          description={canManage ? t('noStoreYetDescription') : t('createStoreForbidden')}
          action={
            canManage ? (
              <Button type="button" onClick={handleCreate} disabled={creating}>
                {creating ? t('createStoreCreating') : t('createStoreAction')}
              </Button>
            ) : undefined
          }
        />
      ) : null}

      {catalog.status === 'ready' ? (
        <Table>
          <THead>
            <TR>
              <TH>{t('storesListName')}</TH>
              <TH>{t('storesListStatus')}</TH>
              <TH>{t('storesListPreview')}</TH>
              {canManage ? <TH>{t('storesListActions')}</TH> : null}
            </TR>
          </THead>
          <TBody>
            {catalog.stores.map((store) => (
              <TR key={store.id}>
                <TD className="font-medium text-text">{store.name}</TD>
                <TD>
                  <Badge tone={store.isActive ? 'positive' : 'muted'}>
                    {store.isActive ? t('storesListActive') : t('storesListInactive')}
                  </Badge>
                </TD>
                <TD>
                  {store.previewUrl ? (
                    <a
                      href={store.previewUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary underline-offset-2 hover:underline"
                    >
                      {store.previewUrl}
                    </a>
                  ) : (
                    <span className="text-muted">{t('storesListNoPreview')}</span>
                  )}
                </TD>
                {canManage ? (
                  <TD>
                    <Button type="button" variant="outline" size="sm" onClick={() => setSettingsStore(store)}>
                      {t('storeSettingsAction')}
                    </Button>
                  </TD>
                ) : null}
              </TR>
            ))}
          </TBody>
        </Table>
      ) : null}

      {settingsStore ? (
        <StoreSettingsDialog
          open
          store={settingsStore}
          locale={locale}
          onClose={() => setSettingsStore(null)}
          onSaved={async (storeId) => {
            await refresh(storeId);
            showSuccessToast(t('storeSettingsSuccess'));
          }}
        />
      ) : null}
    </div>
  );
}
