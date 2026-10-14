'use client';

import { CommunicationsCatalog } from '@/components/integrations/communications-catalog';
import { COMMUNICATIONS_PERMISSION } from '@/lib/communications-providers';
import { useCan } from '@/lib/use-can';

/**
 * الإعدادات › مركز التكاملات › مزودو الاتصالات (AWJ-COMMS-UX-01). وصف ثابت — لا طلب شبكة إطلاقاً.
 * الصلاحية `company.manage` (قرار اختيار مزوّد للمالك/المدير) عبر `useCan` (AC-UX-07)؛ قبل الترطيب لا يُعرض شيء
 * كي لا يومض رفضٌ كاذب قبل قراءة الجلسة.
 */
export default function CommunicationsProvidersPage() {
  const { can, hydrated } = useCan();

  if (!hydrated) return null;
  return <CommunicationsCatalog allowed={can(COMMUNICATIONS_PERMISSION)} />;
}
