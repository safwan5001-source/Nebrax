'use client';

import { useEffect, useState } from 'react';
import { CommunicationsCatalog } from '@/components/integrations/communications-catalog';
import { currentUser } from '@/lib/auth';
import { COMMUNICATIONS_PERMISSION } from '@/lib/communications-providers';
import { hasPermission } from '@/lib/permissions';

/**
 * الإعدادات › مركز التكاملات › مزودو الاتصالات (AWJ-COMMS-UX-01). وصف ثابت — لا طلب شبكة إطلاقاً.
 * الصلاحية `company.manage` (قرار اختيار مزوّد للمالك/المدير)؛ قبل حسمها لا يُعرض شيء.
 */
export default function CommunicationsProvidersPage() {
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    const user = currentUser();
    setAllowed(hasPermission(user?.permissions, user?.role, COMMUNICATIONS_PERMISSION));
  }, []);

  if (allowed === null) return null;
  return <CommunicationsCatalog allowed={allowed} />;
}
