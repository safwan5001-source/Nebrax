import { InvoicePaymentForm } from '@/components/payments/invoice-payment-form';

export default async function NewInvoicePaymentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <InvoicePaymentForm invoiceId={id} />;
}
