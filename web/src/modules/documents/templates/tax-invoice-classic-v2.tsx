'use client';

import type { DocumentTemplateProps } from '../types';
import { DocumentBody } from '../components/document-body';
import { CLASSIC_V2_STYLE } from './template-styles';

/** Classic V2 — رسمي تقليدي. هوية `tax-invoice-classic-v2` مستقلة عن التاريخي. */
export function TaxInvoiceClassicV2(props: DocumentTemplateProps) {
  return <DocumentBody {...props} style={CLASSIC_V2_STYLE} />;
}
