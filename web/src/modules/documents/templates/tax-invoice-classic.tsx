'use client';

import type { DocumentTemplateProps } from '../types';
import { DocumentBody } from '../components/document-body';
import { CLASSIC_STYLE } from './template-styles';

/** القالب الكلاسيكي (فاتورة ضريبية) — رأس جدول بلون الهوية، زوايا معتدلة. */
export function TaxInvoiceClassic(props: DocumentTemplateProps) {
  return <DocumentBody {...props} style={CLASSIC_STYLE} />;
}
