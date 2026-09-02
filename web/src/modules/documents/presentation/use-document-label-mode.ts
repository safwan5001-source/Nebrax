'use client';

import { useLocale } from 'next-intl';
import type { DocumentModel } from '../types';
import { resolveDirection } from '../utils/direction';
import { resolveDocumentLabelMode, type DocumentLabelMode } from './visual-v2';

/** وضع تسمية Modern من لغة الواجهة واتجاه المستند المحسوم. */
export function useDocumentLabelMode(model: DocumentModel): { locale: string; mode: DocumentLabelMode } {
  const locale = useLocale();
  const direction = resolveDirection(model.direction, model.seller.name || model.buyer.name);
  return { locale, mode: resolveDocumentLabelMode(locale, direction) };
}
