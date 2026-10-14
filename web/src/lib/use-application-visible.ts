'use client';

import { useEffect, useState } from 'react';
import { api } from './api';
import { isApplicationHidden } from './integration-center';

/**
 * هل قدرة `ApplicationCatalog` ظاهرة لهذا المستأجر حسب `GET /applications/nav-state`؟
 *
 * عقد الشريط الجانبي نفسه (`hiddenApplicationKeys`): `false` الصريح وحده يُخفي؛ غياب المفتاح
 * أو فشل القراءة لا يُخفي شيئاً — المسار محروس في الخادم على أي حال. يعيد `null` أثناء القراءة
 * كي يُخفي المستدعي إجراءً ثانوياً بدل أن يومض ثم يختفي.
 */
export function useApplicationVisible(key: string): boolean | null {
  const [visible, setVisible] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<unknown>('/applications/nav-state')
      .then((payload) => {
        if (!cancelled) setVisible(!isApplicationHidden(payload, key));
      })
      .catch(() => {
        if (!cancelled) setVisible(true);
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  return visible;
}
