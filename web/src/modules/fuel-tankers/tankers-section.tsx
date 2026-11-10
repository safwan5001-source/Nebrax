'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Pencil, Plus, Truck } from 'lucide-react';
import { EmptyState, ErrorState, LoadingState, MobileRecordItem, Pagination } from '@/components/nebrax';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { formatMillilitersAsLiters } from '@/lib/fuel-quantity';
import { classifyError, TANKER_MANAGE } from './access';
import { listTankers } from './client';
import { StatusBadge } from './states';
import { TankerDialog } from './tanker-dialog';
import type { Paged, Tanker, TankerOwner } from './types';

/** صهاريج صاحب الصهريج: تعريف (لوحة وسعة اختيارية) فقط — ليس مخزوناً ولا خزاناً افتراضياً. الإضافة تتطلب صاحباً نشطاً (قاعدة الخادم). */
export function TankersSection({ owner, canManage }: { owner: TankerOwner; canManage: boolean }) {
  const t = useTranslations('fuelTankers');
  const locale = useLocale();
  const { success } = useToast();
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Paged<Tanker> | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [dialog, setDialog] = useState<{ open: boolean; tanker?: Tanker }>({ open: false });
  const sequence = useRef(0);
  const ownerActive = owner.status === 'active';
  const liters = t('units.liter');
  /* السعة اختيارية: null = غير محدّدة وتُعرض نصًّا صريحًا (الدالة المشتركة تحوّل null إلى 0 فتُظهر سعة صفرية كاذبة) */
  const capacityText = (milliliters: number | null) => (milliliters === null || milliliters === undefined ? t('tanker.capacityUnspecified') : formatMillilitersAsLiters(milliliters, locale, liters));

  const load = useCallback(async () => {
    const mine = ++sequence.current;
    setState('loading');
    try {
      const data = await listTankers(owner.id, page);
      if (mine !== sequence.current) return;
      setResult(data);
      setState('ready');
    } catch (error) {
      if (mine !== sequence.current) return;
      void classifyError(error, 'list');
      setState('error');
    }
  }, [owner.id, page]);

  useEffect(() => { void load(); }, [load]);

  const addDisabledReason = !canManage ? t('states.manageRequired', { permission: TANKER_MANAGE }) : !ownerActive ? t('tanker.ownerInactive') : undefined;
  const rows = result?.rows ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>{t('tanker.sectionTitle')}{result ? <span className="num ms-2 text-sm font-normal text-muted">({result.meta.total})</span> : null}</CardTitle>
        <Button size="sm" className="max-md:h-11" disabled={addDisabledReason !== undefined} title={addDisabledReason} onClick={() => setDialog({ open: true })}>
          <Plus className="h-4 w-4" aria-hidden="true" />{t('tanker.create')}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {addDisabledReason !== undefined && canManage ? <p role="note" className="text-xs text-muted">{addDisabledReason}</p> : null}
        {state === 'loading' && result === null ? <LoadingState variant="cards" rows={2} surface="bare" label={t('tanker.loading')} /> : null}
        {state === 'error' ? <ErrorState surface="bare" message={t('tanker.loadFailed')} onRetry={() => void load()} /> : null}
        {state !== 'error' && result !== null ? (
          rows.length === 0 ? (
            <EmptyState surface="bare" icon={Truck} title={t('tanker.empty')} description={t('tanker.emptyHint')} />
          ) : (
            <div aria-busy={state === 'loading'} className={state === 'loading' ? 'opacity-60' : undefined}>
              <div className="hidden overflow-x-auto rounded border border-border md:block">
                <Table>
                  <THead>
                    <TR>
                      <TH>{t('tanker.plate')}</TH>
                      <TH>{t('tanker.country')}</TH>
                      <TH>{t('tanker.capacity')}</TH>
                      <TH>{t('tanker.status')}</TH>
                      <TH><span className="sr-only">{t('common.actions')}</span></TH>
                    </TR>
                  </THead>
                  <TBody>
                    {rows.map((tanker) => (
                      <TR key={tanker.id}>
                        <TD className="font-medium"><bdi>{tanker.plate_number}</bdi></TD>
                        <TD><span dir="ltr">{tanker.plate_country ?? '—'}</span></TD>
                        <TD><span className="num">{capacityText(tanker.capacity_milliliters)}</span></TD>
                        <TD><StatusBadge status={tanker.status} /></TD>
                        <TD className="text-end">
                          <Button size="sm" className="max-md:h-11" variant="outline" disabled={!canManage} title={!canManage ? t('states.manageRequired', { permission: TANKER_MANAGE }) : undefined}
                            aria-label={t('tanker.editAria', { plate: tanker.plate_number })} onClick={() => setDialog({ open: true, tanker })}>
                            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />{t('common.edit')}
                          </Button>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>
              <ul className="divide-y divide-border rounded border border-border md:hidden">
                {rows.map((tanker) => (
                  <li key={tanker.id}>
                    <MobileRecordItem record={{
                      title: tanker.plate_number,
                      subtitle: tanker.plate_country ?? undefined,
                      amountLabel: t('tanker.capacity'),
                      amount: capacityText(tanker.capacity_milliliters),
                      status: <StatusBadge status={tanker.status} />,
                      actions: (
                        <Button size="sm" className="max-md:h-11" variant="ghost" disabled={!canManage} aria-label={t('tanker.editAria', { plate: tanker.plate_number })} onClick={() => setDialog({ open: true, tanker })}>
                          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />{t('common.edit')}
                        </Button>
                      ),
                    }} />
                  </li>
                ))}
              </ul>
              {result.meta.last_page > 1 ? (
                <Pagination className="mt-3" page={result.meta.current_page} lastPage={result.meta.last_page} perPage={result.meta.per_page} total={result.meta.total}
                  disabled={state === 'loading'} onPageChange={setPage} />
              ) : null}
            </div>
          )
        ) : null}
      </CardContent>
      <TankerDialog
        open={dialog.open}
        ownerId={owner.id}
        tanker={dialog.tanker}
        onClose={() => setDialog({ open: false })}
        onSaved={(saved) => { setDialog({ open: false }); success(dialog.tanker ? t('tanker.updated') : t('tanker.created', { plate: saved.plate_number })); void load(); }}
      />
    </Card>
  );
}
