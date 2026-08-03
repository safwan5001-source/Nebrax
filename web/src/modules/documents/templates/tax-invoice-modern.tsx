'use client';

import type { DocumentTemplateProps } from '../types';
import { DocumentBody } from '../components/document-body';
import { MODERN_STYLE } from './template-styles';

/** Modern — مساحات أوسع، زوايا ناعمة، رأس جدول خفيف بلون الهوية الفاتح. */
export function TaxInvoiceModern(props: DocumentTemplateProps) {
  return <DocumentBody {...props} style={MODERN_STYLE} />;
}
