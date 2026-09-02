'use client';

import type { DocumentTemplateProps } from '../types';
import { DocumentBody } from '../components/document-body';
import { ERP_V2_STYLE } from './template-styles';

/** ERP V2 — دفتر يومي كثيف. هوية `tax-invoice-erp-v2` مستقلة عن التاريخي. */
export function TaxInvoiceErpV2(props: DocumentTemplateProps) {
  return <DocumentBody {...props} style={ERP_V2_STYLE} />;
}
