'use client';

import { useState } from 'react';
import { useLocale } from 'next-intl';
import { Store as StoreIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/nebrax';
import { currentUser } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import { commerceWorkspaceMessage } from '@/modules/commerce-workspace/messages';
import { useCommerceStoreContext } from '@/modules/commerce-workspace/store-context';
import {
  activateCommerceStorefront,
  deactivateCommerceStorefront,
  provisionCommerceStorefront,
  type CommerceStoreOption,
} from '@/modules/commerce-workspace/stores';
import { StoreSettingsDialog } from '@/modules/commerce-workspace/store-settings-dialog';

/**
 * COM-STORE-PROVISION-1 — شاشة «المتاجر»: تعرض الكتالوج الموثوق من
 * `CommerceStoreProvider`، وحين لا يوجد متجر بعد تعرض فعل التزويد الصريح
 * الوحيد المسموح به («إنشاء متجر إلكتروني»). لا تزويد تلقائي عند تحميل
 * الشاشة — الفعل يبدأ فقط بنقرة صريحة من مستخدم يملك `commerce.manage`.
 *
 * STORE-ADMIN-LIFECYCLE-1 — تفعيل/إيقاف خدمة المتجر المستضاف، مع تأكيد
 * قبل الإيقاف. الإعدادات تبقى متاحة للمتجر المتوقف.
 */
export default function CommerceStoresPage() {
  const locale = useLocale();
  const t = (key: Parameters<typeof commerceWorkspaceMessage>[1]) => commerceWorkspaceMessage(locale, key);
  const { catalog, refresh } = useCommerceStoreContext();
  const { error: showErrorToast, success: showSuccessToast } = useToast();
  const [creating, setCreating] = useState(false);
  const [settingsStore, setSettingsStore] = useState<CommerceStoreOption | null>(null);
  const [deactivateStore, setDeactivateStore] = useState<CommerceStoreOption | null>(null);
  const [lifecycleBusyId, setLifecycleBusyId] = useState<string | null>(null);

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

  const handleActivate = async (store: CommerceStoreOption) => {
    if (lifecycleBusyId) return;
    setLifecycleBusyId(store.id);
    try {
      const result = await activateCommerceStorefront(store.id);
      if (!result.ok) {
        showErrorToast(t('storeActivateFailed'));
        return;
      }
      await refresh(store.id);
      showSuccessToast(t('storeActivateSuccess'));
    } finally {
      setLifecycleBusyId(null);
    }
  };

  const handleDeactivateConfirm = async () => {
    if (!deactivateStore || lifecycleBusyId) return;
    const storeId = deactivateStore.id;
    setLifecycleBusyId(storeId);
    try {
      const result = await deactivateCommerceStorefront(storeId);
      if (!result.ok) {
        showErrorToast(t('storeDeactivateFailed'));
        return;
      }
      setDeactivateStore(null);
      await refresh(storeId);
      showSuccessToast(t('storeDeactivateSuccess'));
    } finally {
      setLifecycleBusyId(null);
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
                    <div className="flex flex-wrap items-center gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => setSettingsStore(store)}>
                        {t('storeSettingsAction')}
                      </Button>
                      {store.isActive ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setDeactivateStore(store)}
                          disabled={lifecycleBusyId === store.id}
                        >
                          {t('storeDeactivateAction')}
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => handleActivate(store)}
                          disabled={lifecycleBusyId === store.id}
                        >
                          {lifecycleBusyId === store.id ? t('storeActivateActivating') : t('storeActivateAction')}
                        </Button>
                      )}
                    </div>
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

      {deactivateStore ? (
        <Dialog
          open
          onClose={() => {
            if (!lifecycleBusyId) setDeactivateStore(null);
          }}
          title={t('storeDeactivateTitle')}
          className="max-w-md"
        >
          <div className="space-y-4">
            <p className="text-sm leading-relaxed text-text">{t('storeDeactivateConfirm')}</p>
            <p className="rounded border border-border bg-background px-3 py-2 text-sm font-medium text-text">
              {deactivateStore.name}
            </p>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDeactivateStore(null)}
                disabled={lifecycleBusyId === deactivateStore.id}
              >
                {t('storeSettingsCancel')}
              </Button>
              <Button
                type="button"
                variant="danger"
                onClick={handleDeactivateConfirm}
                disabled={lifecycleBusyId === deactivateStore.id}
              >
                {lifecycleBusyId === deactivateStore.id
                  ? t('storeDeactivateDeactivating')
                  : t('storeDeactivateConfirmAction')}
              </Button>
            </div>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
