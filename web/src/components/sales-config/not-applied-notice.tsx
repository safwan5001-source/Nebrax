'use client';

import { Info } from 'lucide-react';
import { useTranslations } from 'next-intl';

/**
 * COPS-H4-7 (R-12 / D-OPS-13، خيار ب): وسم صفحات إعدادات المبيعات القديمة التي **لا يقرؤها أي مسار** في النظام (`sales_config.orders` و`sales_config.shipping`).
 * الصفحة تبقى تعمل كما هي (قراءة وكتابة، بلا حذف بيانات)؛ الوسم يصحّح توقّع المستخدم فقط. الإخفاء الفعلي لاحقاً بقرار.
 */
export function NotAppliedNotice() {
  const t = useTranslations('salesSettings');

  return (
    <div role="note" className="flex items-start gap-2 rounded border border-warning/40 bg-warning/5 p-3 text-sm text-text">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
      <div>
        <p className="font-medium">{t('not_applied_badge')}</p>
        <p className="mt-0.5 text-muted">{t('not_applied_notice')}</p>
      </div>
    </div>
  );
}
