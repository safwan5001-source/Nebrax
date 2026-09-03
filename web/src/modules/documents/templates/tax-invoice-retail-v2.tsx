'use client';

import type { DocumentTemplateProps } from '../types';
import { DocumentBody } from '../components/document-body';
import { RETAIL_V2_STYLE } from './template-styles';

/** Retail V2 — تجاري سريع المسح. هوية `tax-invoice-retail-v2` مستقلة عن التاريخي. */
export function TaxInvoiceRetailV2(props: DocumentTemplateProps) {
  return <DocumentBody {...props} style={RETAIL_V2_STYLE} sections={{ ...props.sections, barcode: true }} />;
}
