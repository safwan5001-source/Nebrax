'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { currentUser } from '@/lib/auth';

/** صلاحيات المستخدم الحالي: من الجلسة المحفوظة أولاً ثم `/me`. `null` = لم تُحمَّل بعد؛ فشل التحميل ⇒ `[]` (منع، فشل مغلق). عرض فقط — الخادم هو السلطة. */
export function usePermissions(): string[] | null {
  const [permissions, setPermissions] = useState<string[] | null>(() => currentUser()?.permissions ?? null);

  useEffect(() => {
    if (permissions !== null) return;
    let cancelled = false;
    api<{ user: { permissions?: string[] } }>('/me')
      .then((response) => { if (!cancelled) setPermissions(response.user.permissions ?? []); })
      .catch(() => { if (!cancelled) setPermissions([]); });
    return () => { cancelled = true; };
  }, [permissions]);

  return permissions;
}
