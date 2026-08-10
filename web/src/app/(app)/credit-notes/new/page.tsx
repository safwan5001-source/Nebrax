'use client';

import { CreditNoteForm } from '@/components/credit-notes/credit-note-form';

/** إنشاء إشعار دائن (للعميل). */
export default function NewCreditNotePage() {
  return <CreditNoteForm type="sales" />;
}
