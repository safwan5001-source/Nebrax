'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Lock, SearchX, ShieldAlert } from 'lucide-react';
import { EmptyState } from '@/components/nebrax';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TANKER_MANAGE, TANKER_VIEW } from './access';
import type { LinkPhase, TankerStatus } from './types';

const WORKSPACE = '/fuel-stations';

/** الميزة مغلقة في نشر هذا الحساب (يردّ الخادم 404 موحَّداً): حالة صريحة لا خطأ عاماً ولا شاشة بيضاء. */
export function GateClosedState() {
  const t = useTranslations('fuelTankers');
  return (
    <EmptyState
      icon={Lock}
      titleAs="h1"
      title={t('states.gateClosedTitle')}
      description={t('states.gateClosedBody')}
      action={<Button asChild variant="outline"><Link href={WORKSPACE}>{t('states.backToWorkspace')}</Link></Button>}
    />
  );
}

/** لا صلاحية: يُذكر المفتاح المطلوب ومن يمنحه، فيعرف المستخدم ما يطلبه. */
export function ForbiddenState({ required = TANKER_VIEW }: { required?: string }) {
  const t = useTranslations('fuelTankers');
  return (
    <EmptyState
      icon={ShieldAlert}
      titleAs="h1"
      title={t('states.forbiddenTitle')}
      description={t('states.forbiddenBody')}
      action={<code dir="ltr" className="rounded bg-primary-soft px-2 py-1 text-xs text-text">{required}</code>}
    />
  );
}

export function NotFoundState() {
  const t = useTranslations('fuelTankers');
  return (
    <EmptyState
      icon={SearchX}
      titleAs="h1"
      title={t('states.notFoundTitle')}
      description={t('states.notFoundBody')}
      action={<Button asChild variant="outline"><Link href="/fuel-stations/tanker-owners">{t('states.backToList')}</Link></Button>}
    />
  );
}

/** مستخدم يرى ولا يدير: يُقال له صراحةً لماذا الأزرار معطّلة وما الحقول التي لا تظهر له. */
export function ViewOnlyNotice() {
  const t = useTranslations('fuelTankers');
  return (
    <p role="note" className="rounded-md border border-border bg-primary-soft px-3 py-2 text-sm text-text">
      {t('states.viewOnly', { permission: TANKER_MANAGE })}
    </p>
  );
}

const STATUS_TONE: Record<TankerStatus, 'positive' | 'warning' | 'neutral'> = { active: 'positive', suspended: 'warning', inactive: 'neutral' };

export function StatusBadge({ status }: { status: TankerStatus }) {
  const t = useTranslations('fuelTankers');
  return <Badge tone={STATUS_TONE[status] ?? 'neutral'}>{t(`status.${status}`)}</Badge>;
}

const PHASE_TONE: Record<LinkPhase, 'positive' | 'warning' | 'muted'> = { active: 'positive', upcoming: 'warning', ended: 'muted' };

export function PhaseBadge({ phase }: { phase: LinkPhase }) {
  const t = useTranslations('fuelTankers');
  return <Badge tone={PHASE_TONE[phase]}>{t(`phase.${phase}`)}</Badge>;
}
