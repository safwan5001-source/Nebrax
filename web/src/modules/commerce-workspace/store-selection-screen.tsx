'use client';

import { useId, useState, type FormEvent } from 'react';
import { useLocale } from 'next-intl';
import { Store } from 'lucide-react';
import { EmptyState, ErrorState, LoadingState } from '@/components/nebrax';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { commerceWorkspaceMessage } from './messages';
import { useCommerceStoreContext } from './store-context';

/**
 * AWJ-STORE-CTX-1/2 — شاشة اختيار المتجر الصريح. تظهر بدل أي واجهة مرتبطة بمتجر حين لا يوجد متجر محسوم:
 *   • `needs_selection`: مستأجر بأكثر من متجر ولا سياق في هذا التبويب (لا افتراضي `stores[0]`).
 *   • `invalid`: رابط/جلسة تبويب تطلب متجراً غير موجود في قائمة المستأجر (لا بديل صامت).
 *
 * القائمة هي قائمة الخادم المحصورة بمستأجر الجلسة وصلاحياتها (`GET commerce/workspace/storefronts`) — لا متجر يُخترع
 * هنا. الاختيار يتمّ بفعل صريح («اختيار المتجر») لا بمجرّد التنقّل بين الخيارات، فالأسهم تتحرّك بين الأزرار الراديوية
 * دون أن تفتح متجراً. الحالة العرضية فقط؛ الخادم يتحقق من ملكية `{id}` في كل طلب.
 */
export function StoreSelectionScreen() {
  const locale = useLocale();
  const t = (key: Parameters<typeof commerceWorkspaceMessage>[1]) => commerceWorkspaceMessage(locale, key);
  const { catalog, setSelectedStoreId, storeContextStatus, refresh } = useCommerceStoreContext();
  const [choice, setChoice] = useState<string | null>(null);
  const headingId = useId();
  const invalid = storeContextStatus === 'invalid';

  if (catalog.status === 'loading') {
    return <LoadingState variant="cards" rows={2} label={t('storeSelectorLoading')} />;
  }
  if (catalog.status === 'error' || catalog.status === 'unavailable') {
    return <ErrorState message={t('storeSelectorUnavailableHint')} onRetry={() => void refresh()} />;
  }
  if (catalog.status === 'empty') {
    return <EmptyState icon={Store} title={t('noStoreYetTitle')} description={t('noStoreYetDescription')} />;
  }

  const stores = catalog.stores;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (choice && stores.some((store) => store.id === choice)) setSelectedStoreId(choice);
  };

  return (
    <section
      aria-labelledby={headingId}
      data-store-selection-screen=""
      data-store-context-invalid={invalid ? '' : undefined}
      data-store-selection-required={invalid ? undefined : ''}
      className="mx-auto w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-sm"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary">
          <Store className="h-[18px] w-[18px]" strokeWidth={1.7} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 id={headingId} className="text-base font-semibold text-text">
            {invalid ? t('storeContextInvalidTitle') : t('storeSelectionRequiredTitle')}
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            {invalid ? t('storeContextInvalidDescription') : t('storeSelectionRequiredDescription')}
          </p>
        </div>
      </div>

      <form onSubmit={submit} className="mt-4">
        <fieldset>
          <legend className="sr-only">{t('storeSelectorChoose')}</legend>
          <div className="divide-y divide-border overflow-hidden rounded-md border border-border">
            {stores.map((store) => (
              <label
                key={store.id}
                className={cn(
                  'flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm transition-colors',
                  'focus-within:bg-primary-soft hover:bg-primary-soft',
                  choice === store.id ? 'bg-primary-soft' : 'bg-surface',
                )}
              >
                <input
                  type="radio"
                  name="awj-active-store"
                  value={store.id}
                  checked={choice === store.id}
                  onChange={() => setChoice(store.id)}
                  className="h-4 w-4 shrink-0 accent-primary"
                />
                <bdi className="min-w-0 flex-1 truncate font-medium text-text">{store.name}</bdi>
                {!store.isActive ? (
                  <span className="shrink-0 text-xs text-muted">{t('storesListInactive')}</span>
                ) : null}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="mt-4 flex justify-end">
          <Button type="submit" disabled={!choice} data-store-select-action="">
            {t('storeSelectAction')}
          </Button>
        </div>
      </form>
    </section>
  );
}
