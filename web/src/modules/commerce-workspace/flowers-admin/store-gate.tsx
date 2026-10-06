'use client';

import type { ReactNode } from 'react';
import { useLocale } from 'next-intl';
import { Store } from 'lucide-react';
import { EmptyState, ErrorState, LoadingState } from '@/components/nebrax';
import { Select } from '@/components/ui/select';
import { commerceWorkspaceMessage } from '@/modules/commerce-workspace/messages';
import { useCommerceStoreContext } from '@/modules/commerce-workspace/store-context';
import type { CommerceStoreOption } from '@/modules/commerce-workspace/stores';

/**
 * بوابة المتجر المحدَّد لشاشات إعدادات القناة: تعالج حالات القائمة (تحميل/خطأ/فارغة) بصياغة واحدة وتسلّم
 * المتجر المحدَّد فقط حين يكون جاهزاً. المكوّن الابن يُركَّب بـ`key={store.id}` عند المستدعي ليبدأ حالةً
 * نظيفة عند تبديل المتجر — لا نموذج متجرٍ سابق يُحفَظ على متجرٍ آخر.
 */
export function StoreGate({ children }: { children: (store: CommerceStoreOption) => ReactNode }) {
  const locale = useLocale();
  const t = (key: Parameters<typeof commerceWorkspaceMessage>[1]) => commerceWorkspaceMessage(locale, key);
  const { catalog, selectedStoreId, setSelectedStoreId } = useCommerceStoreContext();

  if (catalog.status === 'loading') return <LoadingState variant="table" rows={3} />;
  if (catalog.status === 'error' || catalog.status === 'unavailable') {
    return <ErrorState message={t('storeSelectorUnavailableHint')} />;
  }
  if (catalog.status === 'empty') {
    return <EmptyState icon={Store} title={t('noStoreYetTitle')} description={t('noStoreYetDescription')} />;
  }

  const store = catalog.stores.find((candidate) => candidate.id === selectedStoreId);
  if (!store) return <LoadingState variant="table" rows={3} />;

  return (
    <>
      {/* شريط الهيكل يعرض المتجر على الشاشات المتوسطة فما فوق فقط؛ على الجوال نُظهر هدف الإعداد هنا فلا يُضبط متجرٌ دون أن يُرى اسمه. */}
      <div className="flex items-center gap-2 md:hidden" data-store-context>
        <span className="shrink-0 text-xs text-muted">{t('storeSelectorLabel')}</span>
        {catalog.stores.length > 1 ? (
          <Select aria-label={t('storeSelectorLabel')} className="min-w-0 flex-1" value={store.id} onChange={(event) => setSelectedStoreId(event.target.value)}>
            {catalog.stores.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </Select>
        ) : (
          <span className="min-w-0 truncate text-sm font-medium text-text">{store.name}</span>
        )}
      </div>
      {children(store)}
    </>
  );
}
