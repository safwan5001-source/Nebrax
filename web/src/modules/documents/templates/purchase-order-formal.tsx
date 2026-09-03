'use client';

import type { DocumentTemplateProps } from '../types';
import { DocumentBody } from '../components/document-body';
import { PURCHASE_ORDER_FORMAL_STYLE } from './template-styles';

/**
 * قالب أمر الشراء الإنتاجي — هوية `purchase-order-formal` مستقلة عن الفاتورة وعرض السعر.
 * لا ZATCA QR: يُفرض إخفاء الرمز حتى لو وُجد في النموذج.
 */
export function PurchaseOrderFormal(props: DocumentTemplateProps) {
  return <DocumentBody {...props} style={PURCHASE_ORDER_FORMAL_STYLE} sections={{ ...props.sections, qr: false }} />;
}
