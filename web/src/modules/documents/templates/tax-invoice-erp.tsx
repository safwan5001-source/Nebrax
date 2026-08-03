'use client';

import type { DocumentTemplateProps } from '../types';
import { DocumentBody } from '../components/document-body';
import { ERP_STYLE } from './template-styles';

/** ERP — تخطيط كثيف تقليدي، زوايا حادّة، رأس جدول بلا تعبئة. */
export function TaxInvoiceErp(props: DocumentTemplateProps) {
  return <DocumentBody {...props} style={ERP_STYLE} />;
}
