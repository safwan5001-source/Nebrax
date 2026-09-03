'use client';

import type { DocumentTemplateProps } from '../types';
import { DocumentBody } from '../components/document-body';
import { QUOTATION_PROPOSAL_STYLE } from './template-styles';

/**
 * قالب عرض السعر الإنتاجي — هوية `quotation-proposal` مستقلة عن الفاتورة.
 * لا ZATCA QR: يُفرض إخفاء الرمز حتى لو وُجد في النموذج.
 */
export function QuotationProposal(props: DocumentTemplateProps) {
  return <DocumentBody {...props} style={QUOTATION_PROPOSAL_STYLE} sections={{ ...props.sections, qr: false }} />;
}
