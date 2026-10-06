'use client';

import type { ReactNode } from 'react';
import { useLocale } from 'next-intl';
import { Store } from 'lucide-react';
import { EmptyState, ErrorState, LoadingState } from '@/components/nebrax';
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
  const { catalog, selectedStoreId } = useCommerceStoreContext();

  if (catalog.status === 'loading') return <LoadingState variant="table" rows={3} />;
  if (catalog.status === 'error' || catalog.status === 'unavailable') {
    return <ErrorState message={t('storeSelectorUnavailableHint')} />;
  }
  if (catalog.status === 'empty') {
    return <EmptyState icon={Store} title={t('noStoreYetTitle')} description={t('noStoreYetDescription')} />;
  }

  const store = catalog.stores.find((candidate) => candidate.id === selectedStoreId);
  if (!store) return <LoadingState variant="table" rows={3} />;

  return <>{children(store)}</>;
}
