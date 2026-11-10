'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowRight, Pencil } from 'lucide-react';
import { ErrorState, LoadingState } from '@/components/nebrax';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { formatDate } from '@/lib/formatting';
import { classifyError, hasPermission, TANKER_MANAGE, TANKER_VIEW } from './access';
import { getOwner } from './client';
import { LinksSection } from './links-section';
import { OwnerDialog } from './owner-dialog';
import { ForbiddenState, NotFoundState, StatusBadge, ViewOnlyNotice } from './states';
import { TankersSection } from './tankers-section';
import type { TankerOwner } from './types';
import { usePermissions } from './use-permissions';

type ScreenState = 'loading' | 'ready' | 'not_found' | 'forbidden' | 'error';

/**
 * تفاصيل صاحب الصهريج: البيانات الأساسية، صهاريجه، وربط الشركات. كل قسم يحمّل نفسه فيفشل وحده دون إسقاط الصفحة.
 * 404 على السجل = غير موجود أو خارج حسابك أو الميزة مغلقة (لا يُميَّز، فلا تسريب). الهاتف والملاحظات يرسلها الخادم للمدير فقط.
 */
export function OwnerDetailScreen({ ownerId }: { ownerId: string }) {
  const t = useTranslations('fuelTankers');
  const { success } = useToast();
  const permissions = usePermissions();
  const canView = hasPermission(permissions, TANKER_VIEW);
  const canManage = hasPermission(permissions, TANKER_MANAGE);
  const [owner, setOwner] = useState<TankerOwner | null>(null);
  const [state, setState] = useState<ScreenState>('loading');
  const [editing, setEditing] = useState(false);
  const sequence = useRef(0);

  const load = useCallback(async () => {
    const mine = ++sequence.current;
    setState('loading');
    try {
      const data = await getOwner(ownerId);
      if (mine !== sequence.current) return;
      setOwner(data);
      setState('ready');
    } catch (error) {
      if (mine !== sequence.current) return;
      const problem = error instanceof Error && error.message === 'invalid_id' ? 'not_found' : classifyError(error, 'record');
      setState(problem === 'not_found' ? 'not_found' : problem === 'forbidden' ? 'forbidden' : 'error');
    }
  }, [ownerId]);

  useEffect(() => {
    if (permissions === null || !canView) return;
    void load();
  }, [permissions, canView, load]);

  if (permissions === null) return <LoadingState variant="cards" rows={3} />;
  if (!canView || state === 'forbidden') return <ForbiddenState required={TANKER_VIEW} />;
  if (state === 'not_found') return <NotFoundState />;
  if (state === 'error' && owner === null) return <ErrorState message={t('detail.loadFailed')} onRetry={() => void load()} />;
  if (owner === null) return <LoadingState variant="cards" rows={3} />;

  const sensitiveVisible = owner.phone !== undefined;

  return (
    <div className="space-y-4">
      <Link href="/fuel-stations/tanker-owners" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
        <ArrowRight className="h-4 w-4 rtl:rotate-0 rotate-180" aria-hidden="true" />{t('detail.back')}
      </Link>

      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-semibold tracking-wide text-primary">{t('eyebrow')}</p>
          <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold text-text"><bdi>{owner.name}</bdi><StatusBadge status={owner.status} /></h1>
          {owner.code ? <p className="num text-sm text-muted" dir="ltr">{owner.code}</p> : null}
        </div>
        <Button disabled={!canManage} title={!canManage ? t('states.manageRequired', { permission: TANKER_MANAGE }) : undefined} onClick={() => setEditing(true)}>
          <Pencil className="h-4 w-4" aria-hidden="true" />{t('owner.editTitle')}
        </Button>
      </header>
      {!canManage ? <ViewOnlyNotice /> : null}
      {state === 'error' ? <ErrorState message={t('detail.refreshFailed')} onRetry={() => void load()} /> : null}

      <Card>
        <CardHeader><CardTitle>{t('detail.basics')}</CardTitle></CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2">
            <Item label={t('owner.name')} value={<bdi>{owner.name}</bdi>} />
            <Item label={t('owner.code')} value={owner.code ? <span className="num" dir="ltr">{owner.code}</span> : '—'} />
            <Item label={t('owner.status')} value={<StatusBadge status={owner.status} />} />
            <Item label={t('list.createdAt')} value={<span className="num">{formatDate(owner.created_at)}</span>} />
            <Item label={t('owner.phone')} value={sensitiveVisible ? (owner.phone ? <span className="num" dir="ltr">{owner.phone}</span> : '—') : <span className="text-muted">{t('detail.managerOnly')}</span>} />
            <Item label={t('owner.notes')} value={sensitiveVisible ? (owner.notes ? <span className="whitespace-pre-wrap">{owner.notes}</span> : '—') : <span className="text-muted">{t('detail.managerOnly')}</span>} />
          </dl>
        </CardContent>
      </Card>

      <TankersSection owner={owner} canManage={canManage} />
      <LinksSection owner={owner} canManage={canManage} />

      <OwnerDialog
        open={editing}
        owner={owner}
        onClose={() => setEditing(false)}
        onSaved={(saved) => { setEditing(false); setOwner(saved); success(t('owner.updated')); }}
      />
    </div>
  );
}

function Item({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-sm text-text">{value}</dd>
    </div>
  );
}
