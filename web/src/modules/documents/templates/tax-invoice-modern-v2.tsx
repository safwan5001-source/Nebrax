'use client';

import type { DocumentTemplateProps } from '../types';
import { DocumentBody } from '../components/document-body';
import { MODERN_V2_STYLE } from './template-styles';

/** Modern V2 — المستند المالي الرسمي المعتمد في #616. هوية `tax-invoice-modern-v2`. */
export function TaxInvoiceModernV2(props: DocumentTemplateProps) {
  return <DocumentBody {...props} style={MODERN_V2_STYLE} />;
}
