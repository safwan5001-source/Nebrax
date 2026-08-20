'use client';

import { DocumentPaymentForm } from '@/components/payments/document-payment-form';

export function InvoicePaymentForm({ invoiceId }: { invoiceId: string }) {
  return <DocumentPaymentForm documentId={invoiceId} documentKind="invoice" />;
}
