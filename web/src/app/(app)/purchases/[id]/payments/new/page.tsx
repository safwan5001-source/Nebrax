import { PurchasePaymentForm } from '@/components/payments/purchase-payment-form';

export default async function NewPurchasePaymentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PurchasePaymentForm purchaseId={id} />;
}
