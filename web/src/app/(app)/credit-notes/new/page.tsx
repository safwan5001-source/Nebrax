'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { CreditNoteForm } from '@/components/credit-notes/credit-note-form';

function NewCreditNote() {
  // ?invoice=<id> — يفتح النموذج على فاتورة بعينها (من تفاصيل الفاتورة).
  const invoiceId = useSearchParams().get('invoice');
  return <CreditNoteForm type="sales" initialInvoiceId={invoiceId} />;
}

/** إنشاء إشعار دائن (للعميل). */
export default function NewCreditNotePage() {
  return (
    <Suspense>
      <NewCreditNote />
    </Suspense>
  );
}
