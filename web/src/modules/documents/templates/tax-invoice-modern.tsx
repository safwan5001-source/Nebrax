'use client';

import type { DocumentTemplateProps } from '../types';
import { DocumentBody } from '../components/document-body';
import { MODERN_STYLE } from './template-styles';

/** Modern التاريخي — الشكل ما قبل #616. يبقى هوية `tax-invoice-modern`. */
export function TaxInvoiceModern(props: DocumentTemplateProps) {
  return <DocumentBody {...props} style={MODERN_STYLE} />;
}
