'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Tabs } from '@/components/ui/tabs';
import { flowersAdminT } from '../messages';
import { AddonsSection } from './addons-section';
import { ContentSection } from './content-section';
import { PersonalizationSection } from './personalization-section';
import { PreparationSection } from './preparation-section';

export const GIFTING_SECTIONS = ['preparation', 'personalization', 'addons', 'content'] as const;
export type GiftingSectionId = (typeof GIFTING_SECTIONS)[number];

const isSection = (value: string | null): value is GiftingSectionId => (GIFTING_SECTIONS as readonly (string | null)[]).includes(value);

/** القسم من `?section=` (روابط عميقة)؛ غير المعروف يسقط على أول قسم. */
function initialSection(): GiftingSectionId {
  if (typeof window === 'undefined') return 'preparation';
  const requested = new URLSearchParams(window.location.search).get('section');

  return isSection(requested) ? requested : 'preparation';
}

/**
 * FLOWERS-H2-10 — مساحة «الهدايا والتخصيص» الموحَّدة داخل ملف المنتج: مهلة التجهيز · التخصيص · الإضافات ·
 * المحتوى. لا تخزين جديد: كل قسم يستعمل مساره المستقل ولا يتأثر الباقي. قسمٌ واحد ظاهر في كل مرة بشريط تنقّل
 * فرعي يعرض عدد العناصر المحفوظة لكل قسم (من الخادم)، ولكل قسم شريط حفظه الخاص. الأقسام كلها مركَّبة (مخفيّة عدا
 * النشط) فلا تضيع مسوّدةُ قسمٍ بالتنقّل، وتُحمَّل مرةً واحدة عند فتح التبويب. `key={productId}` عند المستدعي يضمن
 * ألا يعبر نموذجُ منتجٍ إلى آخر. القراءة `products.view` والكتابة `products.manage` (الخادم يفرضهما).
 */
export function ProductGiftingWorkspace({ productId, locale, canManage }: { productId: string; locale: string | undefined; canManage: boolean }) {
  const t = useMemo(() => flowersAdminT(locale), [locale]);
  const [active, setActive] = useState<GiftingSectionId>('preparation');
  useEffect(() => setActive(initialSection()), []);
  const [counts, setCounts] = useState<Partial<Record<GiftingSectionId, number | null>>>({});

  const select = (id: GiftingSectionId) => {
    setActive(id);
    const url = new URL(window.location.href);
    url.searchParams.set('section', id);
    window.history.replaceState(null, '', url.toString());
  };
  const report = useCallback((id: GiftingSectionId) => (count: number | null) => setCounts((current) => (current[id] === count ? current : { ...current, [id]: count })), []);
  const reporters = useMemo(
    () => ({ personalization: report('personalization'), addons: report('addons'), content: report('content') }),
    [report],
  );

  const sections: Record<GiftingSectionId, { label: string; node: React.ReactNode }> = {
    preparation: { label: t('pgTabPreparation'), node: <PreparationSection productId={productId} locale={locale} canManage={canManage} /> },
    personalization: { label: t('pgTabPersonalization'), node: <PersonalizationSection productId={productId} locale={locale} canManage={canManage} onCount={reporters.personalization} /> },
    addons: { label: t('pgTabAddons'), node: <AddonsSection productId={productId} locale={locale} canManage={canManage} onCount={reporters.addons} /> },
    content: { label: t('pgTabContent'), node: <ContentSection productId={productId} locale={locale} canManage={canManage} onCount={reporters.content} /> },
  };

  return (
    <div className="space-y-5" data-product-gifting>
      <p className="max-w-3xl text-xs leading-5 text-muted">{t('pgIntro')}</p>
      <Tabs
        tabs={GIFTING_SECTIONS.map((id) => {
          const count = counts[id];

          return { id: `gift-${id}`, label: sections[id].label, ...(typeof count === 'number' ? { count } : {}) };
        })}
        value={`gift-${active}`}
        onChange={(id) => select(id.replace('gift-', '') as GiftingSectionId)}
      />
      {GIFTING_SECTIONS.map((id) => (
        <div key={id} role="tabpanel" id={`panel-gift-${id}`} aria-labelledby={`tab-gift-${id}`} hidden={active !== id}>
          {sections[id].node}
        </div>
      ))}
    </div>
  );
}
