'use client';

import { useMemo, useState } from 'react';
import { Tabs } from '@/components/ui/tabs';
import { flowersAdminT } from '../messages';
import { PersonalizationSection } from './personalization-section';
import { PreparationSection } from './preparation-section';

export const GIFTING_SECTIONS = ['preparation', 'personalization'] as const;
export type GiftingSectionId = (typeof GIFTING_SECTIONS)[number];

/**
 * FLOWERS-H2-6…H2-10 — مساحة «الهدايا والتخصيص» داخل ملف المنتج. قسمٌ واحد ظاهر في كل مرة بشريط تنقّل فرعي، ولكل
 * قسم شريط حفظه الخاص (لا أزرار حفظ متعدّدة في الشاشة نفسها). الأقسام تُركَّب عند أول زيارة وتبقى مركَّبة بعدها
 * (مخفيّة)، فلا يضيع مسوّدةُ قسمٍ بالتنقّل ولا تُحمَّل كلها دفعة واحدة. `key={productId}` عند المستدعي يضمن ألا يعبر
 * نموذجُ منتجٍ إلى آخر. القراءة `products.view` والكتابة `products.manage` (الخادم يفرضهما).
 */
export function ProductGiftingWorkspace({ productId, locale, canManage }: { productId: string; locale: string | undefined; canManage: boolean }) {
  const t = useMemo(() => flowersAdminT(locale), [locale]);
  const [active, setActive] = useState<GiftingSectionId>('preparation');
  const [visited, setVisited] = useState<ReadonlySet<GiftingSectionId>>(() => new Set<GiftingSectionId>(['preparation']));
  const select = (id: GiftingSectionId) => {
    setActive(id);
    setVisited((current) => (current.has(id) ? current : new Set(current).add(id)));
  };

  const sections: Record<GiftingSectionId, { label: string; node: React.ReactNode }> = {
    preparation: { label: t('prepTitle'), node: <PreparationSection productId={productId} locale={locale} canManage={canManage} /> },
    personalization: { label: t('persTitle'), node: <PersonalizationSection productId={productId} locale={locale} canManage={canManage} /> },
  };

  return (
    <div className="space-y-5" data-product-gifting>
      <p className="max-w-3xl text-xs leading-5 text-muted">{t('pgIntro')}</p>
      <Tabs
        tabs={GIFTING_SECTIONS.map((id) => ({ id: `gift-${id}`, label: sections[id].label }))}
        value={`gift-${active}`}
        onChange={(id) => select(id.replace('gift-', '') as GiftingSectionId)}
      />
      {GIFTING_SECTIONS.map((id) =>
        visited.has(id) ? (
          <div key={id} role="tabpanel" id={`panel-gift-${id}`} aria-labelledby={`tab-gift-${id}`} hidden={active !== id}>
            {sections[id].node}
          </div>
        ) : null,
      )}
    </div>
  );
}
