'use client';

import type { DocumentTemplateProps } from '../types';
import { DocumentBody } from '../components/document-body';
import { RETAIL_STYLE } from './template-styles';

/** Retail — مضغوط لنقاط البيع، مع باركود المستند (يظلّ QR الضريبي). */
export function TaxInvoiceRetail(props: DocumentTemplateProps) {
  return <DocumentBody {...props} style={RETAIL_STYLE} sections={{ ...props.sections, barcode: true }} />;
}
