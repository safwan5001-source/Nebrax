'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronLeft, Plus, Search, Truck } from 'lucide-react';
import { EmptyState, ErrorState, LoadingState, MobileRecordItem, PageHeader, Pagination } from '@/components/nebrax';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { formatDate } from '@/lib/formatting';
import { classifyError, hasPermission, TANKER_MANAGE, TANKER_VIEW } from './access';
import { listOwners } from './client';
import { OwnerDialog } from './owner-dialog';
import { ForbiddenState, GateClosedState, StatusBadge, ViewOnlyNotice } from './states';
import { TANKER_STATUSES, type Paged, type TankerOwner, type TankerStatus } from './types';
import { usePermissions } from './use-permissions';

type ScreenState = 'loading' | 'ready' | 'gate_closed' | 'forbidden' | 'error';

const SEARCH_DEBOUNCE_MS = 300;
const detailHref = (id: string) => `/fuel-stations/tanker-owners/${id}`;

/**
 * قائمة أصحاب الصهاريج: بحث وتصفية بالحالة وترقيم من الخادم. الحالات كلها صريحة: تحميل، خطأ بإعادة محاولة، فراغ (لا بيانات / لا نتائج)، الميزة مغلقة (404)،
 * ولا صلاحية (403 أو غياب المفتاح قبل أي طلب). جوال أولاً: بطاقات تحت `md` وجدول من `md`. الإضافة تتطلب `fuel.tanker.manage`.
 */
export function OwnersScreen() {
  const t = useTranslations('fuelTankers');
  const locale = useLocale();
  const router = useRouter();
  const { success } = useToast();
  const permissions = usePermissions();
  const canView = hasPermission(permissions, TANKER_VIEW);
  const canManage = hasPermission(permissions, TANKER_MANAGE);

  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<TankerStatus | ''>('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Paged<TankerOwner> | null>(null);
  const [state, setState] = useState<ScreenState>('loading');
  const [creating, setCreating] = useState(false);
  const sequence = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => { setQuery(search); setPage(1); }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    const mine = ++sequence.current;
    setState('loading');
    try {
      const data = await listOwners({ page, q: query, status });
      if (mine !== sequence.current) return; // رد متأخر لطلب قديم لا يكتب فوق الأحدث.
      setResult(data);
      setState('ready');
    } catch (error) {
      if (mine !== sequence.current) return;
      const problem = classifyError(error, 'list');
      setState(problem === 'gate_closed' ? 'gate_closed' : problem === 'forbidden' ? 'forbidden' : 'error');
    }
  }, [page, query, status]);

  useEffect(() => {
    if (permissions === null || !canView) return;
    void load();
  }, [permissions, canView, load]);

  if (permissions === null) return <LoadingState variant="table" />;
  if (!canView || state === 'forbidden') return <ForbiddenState required={TANKER_VIEW} />;
  if (state === 'gate_closed') return <GateClosedState />;

  const filtered = query.trim() !== '' || status !== '';
  const rows = result?.rows ?? [];

  function clearFilters() { setSearch(''); setQuery(''); setStatus(''); setPage(1); }

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={t('eyebrow')}
        title={t('list.title')}
        description={t('list.subtitle')}
        actions={[{
          key: 'create', label: t('owner.create'), icon: Plus, variant: 'primary', emphasis: 'primary',
          disabled: !canManage, title: !canManage ? t('states.manageRequired', { permission: TANKER_MANAGE }) : undefined,
          onClick: () => setCreating(true),
        }]}
      />
      {!canManage ? <ViewOnlyNotice /> : null}

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
          <Input
            type="search"
            className="ps-9"
            value={search}
            placeholder={t('list.searchPlaceholder')}
            aria-label={t('list.searchLabel')}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <Select
          className="sm:w-48"
          value={status}
          aria-label={t('list.statusFilter')}
          onChange={(event) => { setStatus(event.target.value as TankerStatus | ''); setPage(1); }}
        >
          <option value="">{t('list.allStatuses')}</option>
          {TANKER_STATUSES.map((value) => <option key={value} value={value}>{t(`status.${value}`)}</option>)}
        </Select>
      </div>

      {state === 'loading' && result === null ? <LoadingState variant="table" label={t('list.loading')} /> : null}
      {state === 'error' ? <ErrorState message={t('list.loadFailed')} onRetry={() => void load()} /> : null}

      {state !== 'error' && result !== null ? (
        rows.length === 0 && state === 'ready' ? (
          filtered ? (
            <EmptyState icon={Search} title={t('list.noResults')} description={t('list.noResultsHint')}
              action={<Button variant="outline" onClick={clearFilters}>{t('list.clearFilters')}</Button>} />
          ) : (
            <EmptyState icon={Truck} title={t('list.empty')} description={t('list.emptyHint')}
              action={canManage ? <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" aria-hidden="true" />{t('owner.create')}</Button> : undefined} />
          )
        ) : (
          <div aria-busy={state === 'loading'} className={state === 'loading' ? 'opacity-60' : undefined}>
            <div className="hidden overflow-x-auto rounded border border-border bg-surface md:block">
              <Table>
                <THead>
                  <TR>
                    <TH>{t('owner.name')}</TH>
                    <TH>{t('owner.code')}</TH>
                    <TH>{t('owner.status')}</TH>
                    <TH>{t('list.createdAt')}</TH>
                    <TH><span className="sr-only">{t('common.actions')}</span></TH>
                  </TR>
                </THead>
                <TBody>
                  {rows.map((owner) => (
                    <TR key={owner.id}>
                      <TD className="font-medium"><Link href={detailHref(owner.id)} className="text-primary hover:underline"><bdi>{owner.name}</bdi></Link></TD>
                      <TD><span className="num" dir="ltr">{owner.code ?? '—'}</span></TD>
                      <TD><StatusBadge status={owner.status} /></TD>
                      <TD><span className="num">{formatDate(owner.created_at, locale)}</span></TD>
                      <TD className="text-end"><Button asChild size="sm" variant="outline"><Link href={detailHref(owner.id)}>{t('list.open')}</Link></Button></TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
            <ul className="divide-y divide-border rounded border border-border bg-surface md:hidden">
              {rows.map((owner) => (
                <li key={owner.id}>
                  <Link href={detailHref(owner.id)} className="block active:bg-primary-soft">
                    <MobileRecordItem record={{
                      title: owner.name,
                      subtitle: owner.code ?? undefined,
                      status: <StatusBadge status={owner.status} />,
                      meta: formatDate(owner.created_at, locale),
                      actions: <span className="flex items-center gap-1 text-xs text-primary">{t('list.open')}<ChevronLeft className="h-4 w-4 rotate-180 rtl:rotate-0" aria-hidden="true" /></span>,
                    }} />
                  </Link>
                </li>
              ))}
            </ul>
            {result.meta.last_page > 1 ? (
              <Pagination page={result.meta.current_page} lastPage={result.meta.last_page} perPage={result.meta.per_page} total={result.meta.total}
                disabled={state === 'loading'} onPageChange={setPage} />
            ) : null}
          </div>
        )
      ) : null}

      <OwnerDialog
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={(owner) => { setCreating(false); success(t('owner.created')); router.push(detailHref(owner.id)); }}
      />
    </div>
  );
}
