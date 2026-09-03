'use client';

import type { DocumentTemplateProps } from '../types';
import { DocumentBody } from '../components/document-body';
import { MINIMAL_V2_STYLE } from './template-styles';

/** Minimal V2 — بياض وطبعة. هوية `tax-invoice-minimal-v2` مستقلة عن التاريخي. */
export function TaxInvoiceMinimalV2(props: DocumentTemplateProps) {
  return <DocumentBody {...props} style={MINIMAL_V2_STYLE} />;
}
