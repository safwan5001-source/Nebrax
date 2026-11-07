'use client';

import { useTranslations } from 'next-intl';
import { Fuel } from 'lucide-react';
import type { Station } from '../schemas';
import { LinkCard } from '../admin/ui';
import { useOpeningAccess, useOpeningDocs } from './data';
import { OPENING_BASE } from './parts';

/**
 * بطاقة الدخول إلى معالج الرصيد الافتتاحي من شاشة «الإدارة». **لا تظهر إلا إذا دعمها الخادم فعلاً**: بوابة النشر مغلقة ⇒ القراءة تردّ 404 ⇒ لا بطاقة
 * (لا خيار غير مدعوم). التحميل والفشل لا يعرضان شيئاً (لا ضجيج في شاشة أخرى).
 */
export function OpeningEntryLink({ station }: { station: Station }) {
  const t = useTranslations('stationOpsOpening');
  const access = useOpeningAccess();
  const docs = useOpeningDocs(station);
  if (!access.draft || docs.state.status !== 'success') return null;
  const posted = docs.state.data.some((row) => row.status === 'posted');
  return <LinkCard href={OPENING_BASE} icon={<Fuel className="h-5 w-5" strokeWidth={1.8} />} title={t('link.title')} hint={posted ? t('link.done') : t('link.hint')} />;
}
