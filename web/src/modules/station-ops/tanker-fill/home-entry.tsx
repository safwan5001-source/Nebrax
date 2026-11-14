'use client';

import { useTranslations } from 'next-intl';
import { Container } from 'lucide-react';
import { LinkCard } from '../admin/ui';
import type { Station } from '../schemas';
import { useTankerFillAccess, useTankerFillFeature } from './data';
import { TANKER_BASE } from './parts';

/**
 * TANKER-PR7 — بطاقة الدخول إلى «تعبئة الصهاريج» في الرئيسية. **الخادم المصدر الوحيد** لتوفّر الميزة: تظهر فقط حين تردّ قراءة السندات 200 (بوابتا النشر مفتوحتان والصلاحية متاحة)؛
 * 404/403/تعذّر ⇒ لا بطاقة ولا أي أثر (الرئيسية كما كانت حرفياً).
 */
export function TankerFillHomeEntry({ station }: { station: Station }) {
  const t = useTranslations('stationOps');
  const access = useTankerFillAccess();
  const feature = useTankerFillFeature(station);
  if (!access.view || feature.state !== 'open') return null;
  return <LinkCard href={TANKER_BASE} title={t('tankerFill.home.title')} hint={t('tankerFill.home.hint')} icon={<Container className="h-5 w-5" strokeWidth={1.8} />} />;
}
