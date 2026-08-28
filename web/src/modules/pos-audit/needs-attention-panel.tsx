'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { ColumnDef } from '@tanstack/react-table';
import { AlertTriangle, Eye, FolderClock, ShieldCheck, ShieldQuestion } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { formatRiyal } from '@/lib/money';
import { DataTable } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Pagination } from '@/components/nebrax';
import { useToast } from '@/components/ui/toast';
import { CaseDetail } from './case-detail';
import { ExceptionDetail } from './exception-detail';
import { casePriorityTone, caseStatusTone, formatDateTime, reviewStateTone, severityTone } from './helpers';
import type { NeedsAttentionRow, Paginated } from './types';

interface Props {
  canReviewExceptions: boolean;
  canPromoteExceptions?: boolean;
  canApprove: boolean;
  canManageCases: boolean;
  canAssignCases: boolean;
  canResolveCases: boolean;
  canCctv: boolean;
  onOpenDigest: () => void;
  onPromoted: (caseId: string) => void;
}

function kindIcon(kind: NeedsAttentionRow['kind']) {
  switch (kind) {
    case 'pending_approval':
      return ShieldCheck;
    case 'attention_case':
      return FolderClock;
    case 'digest_highlight':
      return FolderClock;
    default:
      return AlertTriangle;
  }
}

function primaryTime(row: NeedsAttentionRow): string | null {
  return row.detected_at ?? row.created_at ?? row.last_activity_at ?? row.opened_at ?? (row.digest_date ? `${row.digest_date}T00:00:00Z` : null);
}

export function NeedsAttentionPanel({ canReviewExceptions, canPromoteExceptions, canApprove, canManageCases, canAssignCases, canResolveCases, canCctv, onOpenDigest, onPromoted }: Props) {
  const t = useTranslations('posAudit');
  const locale = useLocale();
  const { success, error: errorToast } = useToast();

  const [rows, setRows] = useState<NeedsAttentionRow[]>([]);
  const [meta, setMeta] = useState({ total: 0, per_page: 25, current_page: 1, last_page: 1 });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [selectedExceptionId, setSelectedExceptionId] = useState<string | null>(null);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [approving, setApproving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const result = await api<Paginated<NeedsAttentionRow>>(`/pos/audit/needs-attention?per_page=${perPage}&page=${page}`);
      setRows(result.data);
      setMeta(result.meta);
    } catch (error) {
      setLoadError(error instanceof ApiError ? error.message : t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [page, perPage, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const kindLabel = (kind: NeedsAttentionRow['kind']) => String(t(`attention.kinds.${kind}` as never, { fallback: kind }));
  const ruleLabel = (key: string) => String(t(`rules.${key}` as never, { fallback: key }));

  async function approve(id: string) {
    setApproving(id);
    try {
      await api(`/pos/audit/approvals/${id}/approve`, { method: 'POST' });
      success(t('approved'));
      await load();
    } catch (error) {
      errorToast(error instanceof ApiError ? error.message : t('loadFailed'));
    } finally {
      setApproving(null);
    }
  }

  function openReference(row: NeedsAttentionRow) {
    switch (row.kind) {
      case 'priority_exception':
      case 'needs_investigation_exception':
        setSelectedExceptionId(row.reference.id);
        return;
      case 'attention_case':
        setSelectedCaseId(row.reference.id);
        return;
      case 'digest_highlight':
        onOpenDigest();
        return;
      default:
        return;
    }
  }

  const columns = useMemo<ColumnDef<NeedsAttentionRow, unknown>[]>(
    () => [
      {
        id: 'kind',
        header: t('attention.kind'),
        accessorFn: (row) => kindLabel(row.kind),
        cell: ({ row }) => {
          const Icon = kindIcon(row.original.kind);
          return (
            <span className="flex items-center gap-1.5">
              <Icon className="h-3.5 w-3.5 text-muted" strokeWidth={1.6} aria-hidden="true" />
              {kindLabel(row.original.kind)}
            </span>
          );
        },
      },
      {
        id: 'summary',
        header: t('attention.summary'),
        enableSorting: false,
        cell: ({ row }) => {
          const item = row.original;
          if (item.kind === 'pending_approval') {
            return (
              <div>
                <span className="font-medium text-text">{t(`attention.operations.${item.operation}` as never, { fallback: item.operation ?? '' })}</span>
                <span className="mt-0.5 block text-xs text-muted">{item.performed_by_name ?? '—'}</span>
              </div>
            );
          }
          if (item.kind === 'priority_exception' || item.kind === 'needs_investigation_exception') {
            return (
              <div>
                <span className="font-medium text-text">{ruleLabel(item.rule_key ?? '')}</span>
                <span className="mt-0.5 block text-xs text-muted">{item.subject_name ?? '—'}</span>
              </div>
            );
          }
          if (item.kind === 'attention_case') {
            return (
              <div>
                <span className="num font-medium text-text" dir="ltr">{item.number}</span>
                <span className="mt-0.5 block text-xs text-muted">{item.title}</span>
              </div>
            );
          }
          return (
            <div>
              <span className="font-medium text-text">{t('digest.title')}</span>
              <span className="num mt-0.5 block text-xs text-muted" dir="ltr">{item.digest_date}</span>
            </div>
          );
        },
      },
      {
        id: 'status',
        header: t('status'),
        enableSorting: false,
        cell: ({ row }) => {
          const item = row.original;
          if (item.kind === 'pending_approval') return <Badge tone="warning">{t('pendingApprovals')}</Badge>;
          if (item.kind === 'priority_exception' && item.severity) return <Badge tone={severityTone(item.severity)}>{t(`severities.${item.severity}` as never, { fallback: item.severity })}</Badge>;
          if (item.kind === 'needs_investigation_exception' && item.review_state) return <Badge tone={reviewStateTone(item.review_state)}>{t(`states.${item.review_state}` as never, { fallback: item.review_state })}</Badge>;
          if (item.kind === 'attention_case') {
            return (
              <span className="flex flex-wrap gap-1">
                {item.status && <Badge tone={caseStatusTone(item.status)}>{t(`cases.statuses.${item.status}` as never, { fallback: item.status })}</Badge>}
                {item.priority && <Badge tone={casePriorityTone(item.priority)}>{t(`cases.priorities.${item.priority}` as never, { fallback: item.priority })}</Badge>}
                {(item.reasons ?? []).map((reason) => (
                  <Badge key={reason} tone="muted">{t(`attention.caseReasons.${reason}` as never, { fallback: reason })}</Badge>
                ))}
              </span>
            );
          }
          return <Badge tone="negative">{t('attention.kinds.digest_highlight')}</Badge>;
        },
      },
      {
        id: 'amount',
        header: t('amountUnderReview'),
        enableSorting: false,
        cell: ({ row }) => {
          const item = row.original;
          if (item.kind === 'digest_highlight') return `${item.priority_exceptions_count ?? 0} / ${item.confirmed_loss_count ?? 0}`;
          return item.amount_under_review ? <span className="num">{formatRiyal(item.amount_under_review)}</span> : '—';
        },
      },
      {
        id: 'time',
        header: t('time'),
        accessorFn: (row) => primaryTime(row) ?? '',
        cell: ({ row }) => <span className="num whitespace-nowrap text-xs">{formatDateTime(primaryTime(row.original), locale)}</span>,
      },
      {
        id: 'details',
        header: t('details'),
        enableSorting: false,
        cell: ({ row }) => {
          const item = row.original;
          if (item.kind === 'pending_approval') {
            return canApprove ? (
              <Button size="sm" onClick={() => void approve(item.reference.id)} disabled={approving === item.reference.id}>
                <ShieldCheck className="h-3.5 w-3.5" strokeWidth={1.6} />
                {approving === item.reference.id ? t('approving') : t('approve')}
              </Button>
            ) : (
              <span className="text-xs text-muted">—</span>
            );
          }
          return (
            <Button size="sm" variant="outline" onClick={() => openReference(item)}>
              <Eye className="h-3.5 w-3.5" strokeWidth={1.6} />
              {t('viewDetails')}
            </Button>
          );
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale, t, canApprove, approving],
  );

  return (
    <section className="space-y-4">
      <div className="flex items-start gap-2 rounded border border-border bg-surface p-3 text-sm text-muted">
        <ShieldQuestion className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.6} aria-hidden="true" />
        <p>{t('attention.hint')}</p>
      </div>

      <DataTable
        columns={columns}
        data={rows}
        loading={loading}
        error={loadError}
        onRetry={() => void load()}
        emptyLabel={t('attention.empty')}
        emptyDescription={t('attention.emptyHint')}
        showToolbar={false}
        mobileRecord={(row) => ({
          title: row.kind === 'attention_case' ? (row.title ?? '') : row.kind === 'digest_highlight' ? t('digest.title') : row.kind === 'pending_approval' ? t(`attention.operations.${row.operation}` as never, { fallback: row.operation ?? '' }) : ruleLabel(row.rule_key ?? ''),
          subtitle: kindLabel(row.kind),
          meta: [formatDateTime(primaryTime(row), locale), row.amount_under_review ? formatRiyal(row.amount_under_review) : '—'],
          actions: row.kind === 'pending_approval'
            ? (canApprove && <button className="text-sm font-medium text-primary" onClick={() => void approve(row.reference.id)}>{t('approve')}</button>)
            : <button className="text-sm font-medium text-primary" onClick={() => openReference(row)}>{t('viewDetails')}</button>,
        })}
      />

      <Pagination
        page={meta.current_page}
        lastPage={meta.last_page}
        perPage={perPage}
        total={meta.total}
        disabled={loading}
        onPageChange={(next) => setPage(next)}
        onPerPageChange={(next) => { setPerPage(next); setPage(1); }}
      />

      <p className="rounded border border-border bg-background p-2 text-xs text-muted">{t('notAccusation')}</p>

      <ExceptionDetail
        id={selectedExceptionId}
        canReview={canReviewExceptions}
        canPromote={canPromoteExceptions}
        onClose={() => setSelectedExceptionId(null)}
        onReviewed={() => { setSelectedExceptionId(null); void load(); }}
        onError={(message) => errorToast(message)}
        onPromoted={(caseId) => { setSelectedExceptionId(null); onPromoted(caseId); }}
      />

      <CaseDetail
        id={selectedCaseId}
        canManage={canManageCases}
        canAssign={canAssignCases}
        canResolve={canResolveCases}
        canCctv={canCctv}
        onClose={() => setSelectedCaseId(null)}
        onChanged={() => void load()}
        onError={(message) => errorToast(message)}
      />
    </section>
  );
}
