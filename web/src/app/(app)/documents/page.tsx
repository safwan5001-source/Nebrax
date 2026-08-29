'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { CircleAlert, FileSearch, Filter, RefreshCw, SlidersHorizontal, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { api, ApiError } from '@/lib/api';
import { currentUser } from '@/lib/auth';
import { canManageDocumentCenter } from '@/lib/document-review-access';
import { hasPermission } from '@/lib/permissions';
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
import { BulkReviewerDialog } from '@/components/document-center/bulk-reviewer-dialog';
import { DocumentBatchFiltersDialog } from '@/components/document-center/document-batch-filters-dialog';
import { DocumentUploadDialog } from '@/components/document-center/document-upload-dialog';
import { DocumentOperationsNav } from '@/components/documents/document-operations-nav';
import { useToast } from '@/components/ui/toast';
import {
  DOCUMENT_TYPES,
  type DocumentBatchFilters,
  type DocumentBatchListItem,
  type WorkflowStatusGroup,
  buildBatchListQuery,
  filtersFromSearchParams,
  filtersToSearchParams,
  statusesForGroup,
} from '@/modules/document-center';

type PaginatedResponse = {
  data: DocumentBatchListItem[];
  meta?: { current_page: number; last_page: number; total: number };
};

type TeamUser = { id: string; name: string; permissions?: string[]; role?: string; is_active?: boolean };

const emptyFilters: DocumentBatchFilters = {
  search: '',
  status: '',
  documentType: '',
  sourceType: '',
  channel: '',
  reviewerId: '',
  from: '',
  to: '',
  blockingOnly: false,
};

export default function DocumentsPage() {
  const t = useTranslations('documentCenterReview');
  const ti = useTranslations('documentCenterIntake');
  const { success } = useToast();
  const user = currentUser();
  const canManage = canManageDocumentCenter(user?.permissions, user?.role);
  const router = useRouter();
  const searchParams = useSearchParams();

  const [batches, setBatches] = useState<DocumentBatchListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<DocumentBatchFilters>(() => filtersFromSearchParams(searchParams));
  const [statusGroup, setStatusGroup] = useState<'' | WorkflowStatusGroup>('');
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState<PaginatedResponse['meta']>();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [reviewers, setReviewers] = useState<TeamUser[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkAssignOpen, setBulkAssignOpen] = useState(false);
  const [bulkClearOpen, setBulkClearOpen] = useState(false);
  const [bulkNotice, setBulkNotice] = useState<string | null>(null);

  useEffect(() => {
    setFilters(filtersFromSearchParams(searchParams));
    setPage(1);
  }, [searchParams]);

  useEffect(() => {
    if (!canManage) return;
    api<{ data: TeamUser[] }>('/users')
      .then((response) => setReviewers(response.data.filter((u) => u.is_active !== false && hasPermission(u.permissions, u.role, 'documents.center.review'))))
      .catch(() => setReviewers([]));
  }, [canManage]);

  const hasFilters = Boolean(
    filters.search.trim() || filters.status || filters.documentType || filters.sourceType
    || filters.channel || filters.reviewerId || filters.from || filters.to || filters.blockingOnly || statusGroup,
  );

  const requestPath = useMemo(() => buildBatchListQuery(filters, page), [filters, page]);

  const load = useCallback(async () => {
    if (page === 1) setLoading(true);
    else setLoadingMore(true);
    setError(null);

    try {
      const response = await api<PaginatedResponse>(requestPath);
      const groupStatuses = statusGroup ? new Set(statusesForGroup(statusGroup)) : null;
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
  }, [page, requestPath, statusGroup, t]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 250);
    return () => window.clearTimeout(timer);
  }, [load]);

  function syncFilters(next: DocumentBatchFilters) {
    setFilters(next);
    setPage(1);
    setSelected(new Set());
    const params = filtersToSearchParams(next);
    router.replace(params.toString() ? `/documents?${params.toString()}` : '/documents');
  }

  function resetFilters() {
    setStatusGroup('');
    syncFilters(emptyFilters);
  }

  function handleUploadSuccess() {
    setUploadOpen(false);
    success(ti('uploadSuccess'));
    setPage(1);
    void load();
  }

  const selectedBatches = batches.filter((batch) => selected.has(batch.id));
  const canLoadMore = Boolean(meta && meta.current_page < meta.last_page);

  function toggleSelect(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === batches.length) setSelected(new Set());
    else setSelected(new Set(batches.map((batch) => batch.id)));
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted">{t('subtitle')}</p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <input
            value={filters.search}
            onChange={(event) => syncFilters({ ...filters, search: event.target.value })}
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

      {bulkNotice && (
        <div role="status" className="rounded border border-primary/20 bg-primary-soft px-3 py-2 text-sm text-text">{bulkNotice}</div>
      )}

      <Card>
        <CardContent className="py-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex items-center gap-2 text-sm font-medium text-text">
              <Filter className="h-4 w-4" aria-hidden="true" />
              {t('status')}
            </div>
            <select
              aria-label={ti('statusGroupAll')}
              value={statusGroup}
              onChange={(event) => { setStatusGroup(event.target.value as typeof statusGroup); setPage(1); }}
              className="h-9 min-w-[10rem] rounded border border-border bg-surface px-2 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {STATUS_GROUP_OPTIONS.map((option) => (
                <option key={option.labelKey} value={option.value}>{ti(option.labelKey)}</option>
              ))}
            </select>
            <select
              aria-label={t('documentType')}
              value={filters.documentType}
              onChange={(event) => syncFilters({ ...filters, documentType: event.target.value })}
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
              onChange={(event) => syncFilters({ ...filters, sourceType: event.target.value })}
              className="h-9 min-w-[8rem] rounded border border-border bg-surface px-2 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <option value="">{t('allSources')}</option>
              <option value="manual">{ti('sourceManual')}</option>
              <option value="web">{ti('sourceWeb')}</option>
            </select>
            <Button size="sm" variant="outline" onClick={() => setFiltersOpen(true)}>
              <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
              {t('advancedFilters')}
            </Button>
            {hasFilters && <Button size="sm" variant="ghost" onClick={resetFilters}>{t('cancel')}</Button>}
          </div>
        </CardContent>
      </Card>

      {canManage && selected.size > 0 && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 py-3 text-sm">
            <span>{t('bulkSelected', { count: selected.size })}</span>
            <Button size="sm" onClick={() => setBulkAssignOpen(true)}>{t('bulkAssign')}</Button>
            <Button size="sm" variant="outline" onClick={() => setBulkClearOpen(true)}>{t('bulkClearReviewer')}</Button>
          </CardContent>
        </Card>
      )}

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
                  {canManage && (
                    <th className="px-4 py-3 text-start">
                      <input type="checkbox" aria-label={t('selectAll')} checked={selected.size === batches.length && batches.length > 0} onChange={toggleSelectAll} className="h-4 w-4 rounded border-border" />
                    </th>
                  )}
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
                    {canManage && (
                      <td className="px-4 py-3">
                        <input type="checkbox" checked={selected.has(batch.id)} onChange={() => toggleSelect(batch.id)} aria-label={batch.id} className="h-4 w-4 rounded border-border" />
                      </td>
                    )}
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

      <DocumentBatchFiltersDialog
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        filters={filters}
        reviewers={reviewers}
        onApply={syncFilters}
      />

      {canManage && (
        <>
          <BulkReviewerDialog
            open={bulkAssignOpen}
            onClose={() => setBulkAssignOpen(false)}
            batches={selectedBatches.map((batch) => ({ id: batch.id, version: batch.version }))}
            reviewers={reviewers}
            onComplete={({ success: ok, failed }) => {
              setBulkNotice(t('bulkResult', { success: ok, failed }));
              setSelected(new Set());
              void load();
            }}
          />
          <BulkReviewerDialog
            open={bulkClearOpen}
            onClose={() => setBulkClearOpen(false)}
            batches={selectedBatches.map((batch) => ({ id: batch.id, version: batch.version }))}
            reviewers={reviewers}
            clear
            onComplete={({ success: ok, failed }) => {
              setBulkNotice(t('bulkResult', { success: ok, failed }));
              setSelected(new Set());
              void load();
            }}
          />
        </>
      )}
    </div>
  );
}
