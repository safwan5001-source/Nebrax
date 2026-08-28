'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { ColumnDef } from '@tanstack/react-table';
import { api, ApiError } from '@/lib/api';
import { DataTable } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { formatDateTime, severityTone } from './helpers';
import type { RelationshipRow } from './types';

export function RelationshipsPanel() {
  const t = useTranslations('posAudit');
  const locale = useLocale();
  const { error: errorToast } = useToast();
  const [rows, setRows] = useState<RelationshipRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const result = await api<{ data: RelationshipRow[] }>('/pos/audit/relationships');
      setRows(result.data);
    } catch (error) {
      setLoadError(error instanceof ApiError ? error.message : t('loadFailed'));
      errorToast(error instanceof ApiError ? error.message : t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [errorToast, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const columns = useMemo<ColumnDef<RelationshipRow, unknown>[]>(
    () => [
      { id: 'performer', header: t('performer'), accessorFn: (row) => row.performer_name, cell: ({ row }) => <span className="font-medium text-text">{row.original.performer_name}</span> },
      { id: 'approver', header: t('approver'), accessorFn: (row) => row.approver_name, cell: ({ row }) => <span>{row.original.approver_name}</span> },
      { id: 'approvals', header: t('approvalsCount'), accessorFn: (row) => row.approvals, cell: ({ row }) => <span className="num">{row.original.approvals}</span> },
      { id: 'last', header: t('lastEvent'), accessorFn: (row) => row.last_at ?? '', cell: ({ row }) => <span className="num whitespace-nowrap text-xs">{formatDateTime(row.original.last_at, locale)}</span> },
      {
        id: 'flag',
        header: t('flagged'),
        enableSorting: false,
        cell: ({ row }) =>
          row.original.flagged_severity ? (
            <Badge tone={severityTone(row.original.flagged_severity)}>{t(`severities.${row.original.flagged_severity}` as never, { fallback: row.original.flagged_severity })}</Badge>
          ) : (
            <span className="text-xs text-muted">—</span>
          ),
      },
    ],
    [locale, t],
  );

  return (
    <section className="space-y-3">
      <p className="text-sm text-muted">{t('relationshipsHint')}</p>
      <DataTable
        columns={columns}
        data={rows}
        loading={loading}
        error={loadError}
        onRetry={() => void load()}
        emptyLabel={t('emptyRelationships')}
        searchPlaceholder={t('performer')}
        mobileRecord={(row) => ({
          title: row.performer_name,
          subtitle: `${t('approver')}: ${row.approver_name}`,
          status: row.flagged_severity ? <Badge tone={severityTone(row.flagged_severity)}>{t(`severities.${row.flagged_severity}` as never, { fallback: row.flagged_severity })}</Badge> : undefined,
          meta: [t('approvalsCount'), String(row.approvals)],
        })}
      />
    </section>
  );
}
