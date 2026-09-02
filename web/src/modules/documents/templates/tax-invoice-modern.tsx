'use client';

import type { DocumentTemplateProps } from '../types';
import { DocumentBody } from '../components/document-body';
import { MODERN_STYLE } from './template-styles';

/** Modern V2 — مستند مالي رسمي بفواصل طباعية؛ التركيب من الأقسام المشتركة. */
export function TaxInvoiceModern(props: DocumentTemplateProps) {
  return <DocumentBody {...props} style={MODERN_STYLE} />;
}
