'use client';

import { useMemo } from 'react';
import { flowersAdminT } from '../messages';
import { PreparationSection } from './preparation-section';

/**
 * FLOWERS-H2-6…H2-10 — مساحة «الهدايا والتخصيص» داخل ملف المنتج. تعيد استخدام أقسام كل شريحة دون تخزين جديد؛
 * `key={productId}` عند المستدعي يضمن ألا يعبر نموذجُ منتجٍ إلى آخر. القراءة `products.view` والكتابة
 * `products.manage` (الخادم يفرضهما؛ هنا نعطّل الأدوات للقراءة فقط).
 */
export function ProductGiftingWorkspace({ productId, locale, canManage }: { productId: string; locale: string | undefined; canManage: boolean }) {
  const t = useMemo(() => flowersAdminT(locale), [locale]);

  return (
    <div className="space-y-8" data-product-gifting>
      <p className="max-w-3xl text-xs leading-5 text-muted">{t('pgIntro')}</p>
      <PreparationSection productId={productId} locale={locale} canManage={canManage} />
    </div>
  );
}
