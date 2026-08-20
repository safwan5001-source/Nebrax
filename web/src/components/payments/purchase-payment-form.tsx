'use client';

import { DocumentPaymentForm } from '@/components/payments/document-payment-form';

export function PurchasePaymentForm({ purchaseId }: { purchaseId: string }) {
  return <DocumentPaymentForm documentId={purchaseId} documentKind="purchase" />;
}
