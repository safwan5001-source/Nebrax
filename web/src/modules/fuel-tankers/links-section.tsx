'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Building2, CalendarX2, Link2 } from 'lucide-react';
import { EmptyState, ErrorState, LoadingState, MobileRecordItem, Pagination } from '@/components/nebrax';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { formatDate } from '@/lib/formatting';
import { TANKER_MANAGE } from './access';
import { listLinks } from './client';
import { linkPhase } from './form-logic';
import { EndLinkDialog, LinkDialog } from './link-dialogs';
import { PhaseBadge } from './states';
import type { OwnerCompanyLink, Paged, TankerOwner } from './types';

/**
 * ربط الشركات الرسمية بصاحب الصهريج، مؤرَّخاً (من/إلى). الربط **لا يلغي هوية العميل ولا يعيد نسب عمليات سابقة**، والمنتهي لا يُعاد فتحه ولا يُحذف —
 * فالإجراء الوحيد على ربط مفتوح هو «إنهاء». الربط بصاحب غير نشط مرفوض في الخادم، فيُعطَّل الزر هنا بسببه.
 */
export function LinksSection({ owner, canManage }: { owner: TankerOwner; canManage: boolean }) {
  const t = useTranslations('fuelTankers');
  const locale = useLocale();
  const { success } = useToast();
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Paged<OwnerCompanyLink> | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [creating, setCreating] = useState(false);
  const [ending, setEnding] = useState<OwnerCompanyLink | null>(null);
  const sequence = useRef(0);
  const ownerActive = owner.status === 'active';

  const load = useCallback(async () => {
    const mine = ++sequence.current;
    setState('loading');
    try {
      const data = await listLinks(owner.id, page);
      if (mine !== sequence.current) return;
      setResult(data);
      setState('ready');
    } catch {
      if (mine !== sequence.current) return;
      setState('error');
    }
  }, [owner.id, page]);

  useEffect(() => { void load(); }, [load]);

  const addDisabledReason = !canManage ? t('states.manageRequired', { permission: TANKER_MANAGE }) : !ownerActive ? t('link.ownerInactive') : undefined;
  const rows = result?.rows ?? [];
  const period = (link: OwnerCompanyLink) => `${formatDate(link.valid_from, locale)} → ${link.valid_to ? formatDate(link.valid_to, locale) : t('link.openEnded')}`;
  const endAction = (link: OwnerCompanyLink, variant: 'outline' | 'ghost') => link.valid_to === null && canManage ? (
    <Button size="sm" className="max-md:h-11" variant={variant} aria-label={t('link.endAria', { name: link.partner?.name ?? '' })} onClick={() => setEnding(link)}>
      <CalendarX2 className="h-3.5 w-3.5" aria-hidden="true" />{t('link.end')}
    </Button>
  ) : null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>{t('link.sectionTitle')}{result ? <span className="num ms-2 text-sm font-normal text-muted">({result.meta.total})</span> : null}</CardTitle>
        <Button size="sm" className="max-md:h-11" disabled={addDisabledReason !== undefined} title={addDisabledReason} onClick={() => setCreating(true)}>
          <Link2 className="h-4 w-4" aria-hidden="true" />{t('link.create')}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted">{t('link.rule')}</p>
        {addDisabledReason !== undefined && canManage ? <p role="note" className="text-xs text-muted">{addDisabledReason}</p> : null}
        {state === 'loading' && result === null ? <LoadingState variant="cards" rows={2} surface="bare" label={t('link.loading')} /> : null}
        {state === 'error' ? <ErrorState surface="bare" message={t('link.loadFailed')} onRetry={() => void load()} /> : null}
        {state !== 'error' && result !== null ? (
          rows.length === 0 ? (
            <EmptyState surface="bare" icon={Building2} title={t('link.empty')} description={t('link.emptyHint')} />
          ) : (
            <div aria-busy={state === 'loading'} className={state === 'loading' ? 'opacity-60' : undefined}>
              <div className="hidden overflow-x-auto rounded border border-border md:block">
                <Table>
                  <THead>
                    <TR>
                      <TH>{t('link.company')}</TH>
                      <TH>{t('link.period')}</TH>
                      <TH>{t('link.state')}</TH>
                      <TH>{t('link.note')}</TH>
                      <TH><span className="sr-only">{t('common.actions')}</span></TH>
                    </TR>
                  </THead>
                  <TBody>
                    {rows.map((link) => (
                      <TR key={link.id}>
                        <TD className="font-medium"><bdi>{link.partner?.name ?? '—'}</bdi></TD>
                        <TD><span className="num whitespace-nowrap">{period(link)}</span></TD>
                        <TD><PhaseBadge phase={linkPhase(link)} /></TD>
                        <TD className="max-w-xs truncate text-muted">{link.valid_to ? (link.end_reason ?? link.note ?? '—') : (link.note ?? '—')}</TD>
                        <TD className="text-end">{endAction(link, 'outline')}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>
              <ul className="divide-y divide-border rounded border border-border md:hidden">
                {rows.map((link) => (
                  <li key={link.id}>
                    <MobileRecordItem record={{
                      title: link.partner?.name ?? '—',
                      caption: period(link),
                      status: <PhaseBadge phase={linkPhase(link)} />,
                      actions: endAction(link, 'ghost'),
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
      <LinkDialog
        open={creating}
        owner={owner}
        links={rows}
        onClose={() => setCreating(false)}
        onSaved={() => { setCreating(false); success(t('link.created')); void load(); }}
      />
      <EndLinkDialog
        open={ending !== null}
        ownerId={owner.id}
        link={ending}
        onClose={() => setEnding(null)}
        onSaved={() => { setEnding(null); success(t('link.ended')); void load(); }}
      />
    </Card>
  );
}
