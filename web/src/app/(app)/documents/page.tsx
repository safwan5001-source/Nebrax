'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CircleAlert, FileSearch, Filter, RefreshCw, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { api, ApiError } from '@/lib/api';
import { currentUser } from '@/lib/auth';
import { canManageDocumentCenter } from '@/lib/document-review-access';
import {
  STATUS_GROUP_OPTIONS,
  documentTypeTranslationKey,
  sourceTypeTranslationKey,
  statusBadgeTone,
  statusTranslationKey,
} from '@/lib/document-intake-present';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DocumentUploadDialog } from '@/components/document-center/document-upload-dialog';
import { DocumentOperationsNav } from '@/components/documents/document-operations-nav';
import { useToast } from '@/components/ui/toast';
import { DOCUMENT_TYPES, type WorkflowStatusGroup, statusesForGroup } from '@/modules/document-center/intake-contract';

type Batch = {
  id: string;
  document_type: string;
  source_type: string;
  status: string;
  version: number;
  created_at: string;
  files_count: number;
  blocking_issues_count: number;
  warning_issues_count: number;
  reviewer: { id: string; name: string } | null;
};

type PaginatedResponse = {
  data: Batch[];
  meta?: { current_page: number; last_page: number; total: number };
};

type Filters = {
  statusGroup: '' | WorkflowStatusGroup;
  documentType: string;
  sourceType: string;
  blockingOnly: boolean;
};

const initialFilters: Filters = {
  statusGroup: '',
  documentType: '',
  sourceType: '',
  blockingOnly: false,
};

export default function DocumentsPage() {
  const t = useTranslations('documentCenterReview');
  const ti = useTranslations('documentCenterIntake');
  const { success } = useToast();
  const user = currentUser();
  const canManage = canManageDocumentCenter(user?.permissions, user?.role);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState<PaginatedResponse['meta']>();
  const [uploadOpen, setUploadOpen] = useState(false);

  const hasFilters = Boolean(
    query.trim() || filters.statusGroup || filters.documentType || filters.sourceType || filters.blockingOnly,
  );

  const requestPath = useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      per_page: '20',
      sort: 'created_at',
      direction: 'desc',
    });
    if (query.trim()) params.set('search', query.trim());
    if (filters.documentType) params.set('document_type', filters.documentType);
    if (filters.sourceType) params.set('source_type', filters.sourceType);
    if (filters.blockingOnly) params.set('has_blocking', '1');

    return `/document-batches?${params.toString()}`;
  }, [filters.documentType, filters.sourceType, filters.blockingOnly, page, query]);

  const load = useCallback(async () => {
    if (page === 1) setLoading(true);
    else setLoadingMore(true);
    setError(null);

    try {
      const response = await api<PaginatedResponse>(requestPath);
      const groupStatuses = filters.statusGroup ? new Set(statusesForGroup(filters.statusGroup)) : null;
      const filtered = groupStatuses
        ? response.data.filter((batch) => groupStatuses.has(batch.status))
        : response.data;

      setBatches((current) => page === 1 ? filtered : [...current, ...filtered]);
      setMeta(response.meta);
    } catch (exception) {
      setError(exception instanceof ApiError ? exception.message : t('loadFailed'));
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [filters.statusGroup, page, requestPath, t]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 250);
    return () => window.clearTimeout(timer);
  }, [load]);

  function updateFilters(next: Partial<Filters>) {
    setFilters((current) => ({ ...current, ...next }));
    setPage(1);
  }

  function resetFilters() {
    setQuery('');
    setFilters(initialFilters);
    setPage(1);
  }

  function handleUploadSuccess(batchId: string) {
    setUploadOpen(false);
    success(ti('uploadSuccess'));
    setPage(1);
    void load();
  }

  const canLoadMore = Boolean(meta && meta.current_page < meta.last_page);

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted">{t('subtitle')}</p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <input
            value={query}
            onChange={(event) => { setQuery(event.target.value); setPage(1); }}
            placeholder={t('search')}
            className="h-10 w-full rounded border border-border bg-surface px-3 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:min-w-64"
          />
          {canManage && (
            <Button className="w-full shrink-0 sm:w-auto" onClick={() => setUploadOpen(true)}>
              <Upload className="h-4 w-4" aria-hidden="true" />
              {ti('upload')}
            </Button>
          )}
        </div>
      </header>

      <DocumentOperationsNav />

      <Card>
        <CardContent className="py-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex items-center gap-2 text-sm font-medium text-text">
              <Filter className="h-4 w-4" aria-hidden="true" />
              {t('status')}
            </div>
            <select
              aria-label={ti('statusGroupAll')}
              value={filters.statusGroup}
              onChange={(event) => updateFilters({ statusGroup: event.target.value as Filters['statusGroup'] })}
              className="h-9 min-w-[10rem] rounded border border-border bg-surface px-2 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {STATUS_GROUP_OPTIONS.map((option) => (
                <option key={option.labelKey} value={option.value}>{ti(option.labelKey)}</option>
              ))}
            </select>
            <select
              aria-label={t('documentType')}
              value={filters.documentType}
              onChange={(event) => updateFilters({ documentType: event.target.value })}
              className="h-9 min-w-[10rem] rounded border border-border bg-surface px-2 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <option value="">{t('allDocumentTypes')}</option>
              {DOCUMENT_TYPES.map((type) => (
                <option key={type} value={type}>{ti(documentTypeTranslationKey(type))}</option>
              ))}
            </select>
            <select
              aria-label={t('document')}
              value={filters.sourceType}
              onChange={(event) => updateFilters({ sourceType: event.target.value })}
              className="h-9 min-w-[8rem] rounded border border-border bg-surface px-2 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <option value="">{t('allSources')}</option>
              <option value="manual">{ti('sourceManual')}</option>
              <option value="web">{ti('sourceWeb')}</option>
            </select>
            <label className="flex min-h-9 items-center gap-2 text-sm text-text">
              <input
                type="checkbox"
                checked={filters.blockingOnly}
                onChange={(event) => updateFilters({ blockingOnly: event.target.checked })}
                className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
              />
              {t('blockingOnly')}
            </label>
            {hasFilters && <Button size="sm" variant="ghost" onClick={resetFilters}>{t('cancel')}</Button>}
          </div>
        </CardContent>
      </Card>

      {loading && page === 1 ? (
        <Card><CardContent className="py-10 text-sm text-muted">{t('loading')}</CardContent></Card>
      ) : error ? (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 py-10 text-sm text-muted">
            <CircleAlert className="h-5 w-5" aria-hidden="true" />
            {error}
            <Button variant="outline" onClick={() => void load()}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              {t('retry')}
            </Button>
          </CardContent>
        </Card>
      ) : batches.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-start gap-4 py-10 sm:items-center sm:text-center">
            <div className="flex items-start gap-3 sm:flex-col sm:items-center">
              <FileSearch className="h-8 w-8 shrink-0 text-muted" aria-hidden="true" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-text">
                  {hasFilters ? t('filteredEmpty') : ti('emptyTitle')}
                </p>
                {!hasFilters && (
                  <p className="max-w-lg text-sm text-muted">{ti('emptyDescription')}</p>
                )}
              </div>
            </div>
            {canManage && !hasFilters && (
              <Button onClick={() => setUploadOpen(true)}>
                <Upload className="h-4 w-4" aria-hidden="true" />
                {ti('upload')}
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="hidden overflow-hidden rounded border border-border md:block">
            <table className="w-full text-sm">
              <thead className="bg-surface text-muted">
                <tr>
                  <th className="px-4 py-3 text-start">{t('batch')}</th>
                  <th className="px-4 py-3 text-start">{t('documentType')}</th>
                  <th className="px-4 py-3 text-start">{t('reviewer')}</th>
                  <th className="px-4 py-3 text-start">{t('issues')}</th>
                  <th className="px-4 py-3 text-start">{t('status')}</th>
                  <th className="px-4 py-3 text-end">{t('review')}</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((batch) => (
                  <tr key={batch.id} className="border-t border-border">
                    <td className="px-4 py-3 font-mono">{batch.id.slice(0, 8)}</td>
                    <td className="px-4 py-3">{ti(documentTypeTranslationKey(batch.document_type))}</td>
                    <td className="px-4 py-3">{batch.reviewer?.name ?? t('notAssigned')}</td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs text-muted">{batch.files_count} {t('files')}</span>
                      {batch.blocking_issues_count > 0 && <Badge className="ms-2" tone="negative">{batch.blocking_issues_count} {t('blocking')}</Badge>}
                      {batch.warning_issues_count > 0 && <Badge className="ms-2" tone="warning">{batch.warning_issues_count} {t('warning')}</Badge>}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={statusBadgeTone(batch.status)}>{ti(statusTranslationKey(batch.status))}</Badge>
                    </td>
                    <td className="px-4 py-3 text-end">
                      <Button asChild size="sm">
                        <Link href={`/documents/${batch.id}`}>{t('review')}</Link>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 md:hidden">
            {batches.map((batch) => (
              <Card key={batch.id}>
                <CardContent className="space-y-3 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-mono text-sm">{batch.id.slice(0, 8)}</span>
                    <Badge tone={statusBadgeTone(batch.status)}>{ti(statusTranslationKey(batch.status))}</Badge>
                  </div>
                  <p className="text-sm text-text">{ti(documentTypeTranslationKey(batch.document_type))}</p>
                  <p className="text-xs text-muted">{t('reviewer')}: {batch.reviewer?.name ?? t('notAssigned')}</p>
                  <div className="flex flex-wrap gap-2 text-xs text-muted">
                    <span>{batch.files_count} {t('files')}</span>
                    <span>{ti(sourceTypeTranslationKey(batch.source_type))}</span>
                    {batch.blocking_issues_count > 0 && <Badge tone="negative">{batch.blocking_issues_count} {t('blocking')}</Badge>}
                    {batch.warning_issues_count > 0 && <Badge tone="warning">{batch.warning_issues_count} {t('warning')}</Badge>}
                  </div>
                  <Button asChild className="w-full"><Link href={`/documents/${batch.id}`}>{t('review')}</Link></Button>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted">
              {meta ? t('showing', { shown: batches.length, total: meta.total }) : null}
            </p>
            {canLoadMore && (
              <Button variant="outline" onClick={() => setPage((current) => current + 1)} disabled={loadingMore}>
                {loadingMore ? t('loading') : t('loadMore')}
              </Button>
            )}
          </div>
        </>
      )}

      {canManage && (
        <DocumentUploadDialog
          open={uploadOpen}
          onClose={() => setUploadOpen(false)}
          onSuccess={handleUploadSuccess}
        />
      )}
    </div>
  );
}
