'use client';

import { CreditNoteForm } from '@/components/credit-notes/credit-note-form';

/** إنشاء إشعار مدين (للمورّد) — نفس النموذج بنوع «مشتريات». */
export default function NewDebitNotePage() {
  return <CreditNoteForm type="purchase" />;
}
