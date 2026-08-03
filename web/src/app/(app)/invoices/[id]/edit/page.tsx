'use client';

import { useParams } from 'next/navigation';
import { InvoiceForm } from '@/components/invoices/invoice-form';

export default function EditInvoicePage() {
  const { id } = useParams<{ id: string }>();
  return <InvoiceForm editId={id} />;
}
