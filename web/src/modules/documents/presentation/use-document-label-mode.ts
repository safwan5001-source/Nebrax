'use client';

import { useLocale } from 'next-intl';
import type { DocumentModel } from '../types';
import { resolveDirection } from '../utils/direction';
import { resolveDocumentLabelMode, type DocumentLabelMode } from './visual-v2';

/**
 * وضع تسمية القالب. الأولوية لـ`model.language` (لغة المستند الفعلية القادمة من
 * الخلفية، مصدر الحقيقة الوحيد بعد PR-LANG-1) حين تكون معيَّنة، وإلا يسقط
 * السلوك إلى القديم (لغة الواجهة × اتجاه المستند) — فلا انحدار على المستندات
 * التي لم تُحدَّث بعد.
 */
export function useDocumentLabelMode(model: DocumentModel): { locale: string; mode: DocumentLabelMode } {
  const locale = useLocale();
  if (model.language === 'ar' || model.language === 'en' || model.language === 'bilingual') {
    return { locale, mode: model.language };
  }
  const direction = resolveDirection(model.direction, model.seller.name || model.buyer.name);
  return { locale, mode: resolveDocumentLabelMode(locale, direction) };
}
