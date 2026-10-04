'use client';

import { useTranslations } from 'next-intl';

/** إرشاد اختياري للعرض فقط؛ لا يرتبط بأي تحقق أو معالجة لملف الصورة. */
export function ProductMediaGuidance() {
  const t = useTranslations('products');

  return <p className="text-xs leading-relaxed text-muted">{t('product_image_guidance')}</p>;
}
