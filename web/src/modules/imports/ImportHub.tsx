'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Bot, FileSpreadsheet, Upload } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { EmptyState, ErrorState, LoadingState, PageHeader, Pagination } from '@/components/nebrax';
import { hiddenApplicationKeys, isNavEntryVisible } from '@/components/layout/nav-visibility';
import { api, ApiError } from '@/lib/api';
import { formatDateTime } from '@/lib/formatting';
import { useCurrentUser } from '@/lib/use-can';
import type { ImportJob, ImportJobStatus } from '@/modules/import-jobs/client';
import { hasPermission } from '@/lib/permissions';
import { AiActionsHistory } from './AiActionsHistory';
import { HUB_ENTITIES, HUB_JOB_DOMAINS, HUB_JOB_STATUSES, HUB_SECTIONS, resumeHref } from './catalog';

const STATUS_TONE: Record<ImportJobStatus, 'muted' | 'positive' | 'negative' | 'warning'> = {
  uploaded: 'muted',
  ready: 'muted',
  queued: 'muted',
  processing: 'warning',
  completed: 'positive',
  failed: 'negative',
  cancelled: 'muted',
};
const PER_PAGE_OPTIONS = [10, 25, 50];

interface JobsPage {
  data: ImportJob[];
  meta?: { current_page: number; last_page: number; per_page: number; total: number };
}

/**
 * مركز الاستيراد (IMP-H8-S1): نقطة دخول واحدة لكل ما يُستورد، وسجلّ تشغيلاته. **خريطة تنقّل لا أكثر** — لا يرفع ملفاً ولا يكتب شيئاً؛ كل كيان يقود إلى معالجه القائم بحرّاسه.
 * الاستيراد العادي متاح لكل كيان، والاستيراد بمساعد أَوْج لا يظهر إلا لكيان له مسار مساعد فعلاً (المنتجات اليوم) — وغيره يُعلَن «غير متاح بعد» لا رابطاً وهمياً.
 * السجل = تشغيلات الاستيراد الدائمة (`GET /import-jobs`، مصفّاة بالخادم إلى المجالات التي يراها المستخدم)؛ سجلّ إجراءات المساعد قسمٌ مستقل (`AiActionsHistory`، IMP-H8-S4b) فوق `GET /ai-actions`.
 */
export function ImportHub() {
  const t = useTranslations('importHub');
  const tj = useTranslations('importJobs');
  const locale = useLocale();
  const user = useCurrentUser();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState('');
  const [domain, setDomain] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [jobs, setJobs] = useState<JobsPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<{ data: Record<string, boolean> }>('/applications/nav-state')
      .then((response) => {
        if (cancelled || Array.isArray(response.data)) return;
        setHidden(hiddenApplicationKeys(response.data));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const loadJobs = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const query = new URLSearchParams({ page: String(page), per_page: String(perPage) });
    if (status) query.set('status', status);
    if (domain) query.set('domain', domain);
    api<JobsPage>(`/import-jobs?${query.toString()}`)
      .then((response) => {
        if (!cancelled) setJobs(response);
      })
      .catch((err) => {
        if (cancelled) return;
        setJobs(null);
        setError(err instanceof ApiError ? err.message : t('history_failed'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [page, perPage, status, domain, t]);

  useEffect(() => loadJobs(), [loadJobs]);

  const visible = useMemo(
    () => HUB_ENTITIES.filter((entity) => isNavEntryVisible({ appKey: entity.appKey, permission: entity.permission }, hidden, user)),
    [hidden, user]
  );
  const rows = jobs?.data ?? [];

  return (
    <div className="space-y-6 pb-24 lg:pb-0">
      <PageHeader title={t('title')} description={t('subtitle')} />

      <section aria-labelledby="hub-entities" className="space-y-2">
        <h2 id="hub-entities" className="text-sm font-semibold text-text">{t('entities_title')}</h2>
        {visible.length === 0 ? (
          <EmptyState title={t('entities_empty')} description={t('entities_empty_hint')} />
        ) : (
          <div className="overflow-x-auto rounded border border-border bg-surface">
            <table className="w-full min-w-[44rem] text-sm">
              <thead className="bg-background text-muted">
                <tr>
                  <th className="px-3 py-2 text-start font-medium">{t('col_entity')}</th>
                  <th className="px-3 py-2 text-start font-medium">{t('col_standard')}</th>
                  <th className="px-3 py-2 text-start font-medium">{t('col_assistant')}</th>
                </tr>
              </thead>
              <tbody>
                {HUB_SECTIONS.map((section) => {
                  const entities = visible.filter((entity) => entity.section === section);
                  if (entities.length === 0) return null;
                  return [
                    <tr key={`s-${section}`} className="border-t border-border bg-background">
                      <th colSpan={3} scope="colgroup" className="px-3 py-1.5 text-start text-xs font-medium text-muted">{t(`section_${section}`)}</th>
                    </tr>,
                    ...entities.map((entity) => (
                      <tr key={entity.key} className="border-t border-border align-top">
                        <td className="px-3 py-2.5">
                          <span className="block font-medium text-text">{t(`entity_${entity.key}`)}</span>
                          <span className="mt-0.5 block max-w-md text-xs leading-relaxed text-muted">{t(`entity_${entity.key}_hint`)}</span>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <Button asChild variant="outline" size="sm">
                              <Link href={entity.standardHref} aria-label={`${t('standard')}: ${t(`entity_${entity.key}`)}`}>
                                <Upload className="h-4 w-4" strokeWidth={1.7} />
                                {t('standard')}
                              </Link>
                            </Button>
                            {entity.secondary ? (
                              <Button asChild variant="ghost" size="sm">
                                <Link href={entity.secondary.href} aria-label={`${t(`secondary_${entity.secondary.key}`)}: ${t(`entity_${entity.key}`)}`}>
                                  <FileSpreadsheet className="h-4 w-4" strokeWidth={1.7} />
                                  {t(`secondary_${entity.secondary.key}`)}
                                </Link>
                              </Button>
                            ) : null}
                          </div>
                          {entity.key === 'stocktake_counts' ? <span className="mt-1 block text-xs text-muted">{t('stocktake_note')}</span> : null}
                        </td>
                        <td className="px-3 py-2.5">
                          {entity.aiHref ? (
                            <Button asChild variant="outline" size="sm">
                              <Link href={entity.aiHref} aria-label={`${t('assistant')}: ${t(`entity_${entity.key}`)}`}>
                                <Bot className="h-4 w-4" strokeWidth={1.7} />
                                {t('assistant')}
                              </Link>
                            </Button>
                          ) : (
                            <span className="text-xs text-muted">{t('assistant_unavailable')}</span>
                          )}
                        </td>
                      </tr>
                    )),
                  ];
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="hub-history" className="space-y-2">
        <div className="flex flex-wrap items-end gap-3">
          <h2 id="hub-history" className="me-auto text-sm font-semibold text-text">{t('history_title')}</h2>
          <div className="space-y-1">
            <label htmlFor="hub-domain" className="block text-xs text-muted">{t('filter_domain')}</label>
            <Select id="hub-domain" value={domain} onChange={(event) => { setDomain(event.target.value); setPage(1); }}>
              <option value="">{t('filter_all')}</option>
              {HUB_JOB_DOMAINS.map((value) => (
                <option key={value} value={value}>{t(`domain_${value}`)}</option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <label htmlFor="hub-status" className="block text-xs text-muted">{t('filter_status')}</label>
            <Select id="hub-status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
              <option value="">{t('filter_all')}</option>
              {HUB_JOB_STATUSES.map((value) => (
                <option key={value} value={value}>{tj(`status_${value}` as 'status_ready')}</option>
              ))}
            </Select>
          </div>
        </div>
        <p className="text-xs leading-relaxed text-muted">{t('history_note')}</p>

        {loading ? (
          <LoadingState variant="table" rows={4} />
        ) : error ? (
          <ErrorState message={error} onRetry={loadJobs} />
        ) : rows.length === 0 ? (
          <EmptyState title={t('history_empty')} description={status || domain ? t('history_empty_filtered') : t('history_empty_hint')} />
        ) : (
          <>
            <div className="overflow-x-auto rounded border border-border bg-surface">
              <table className="w-full min-w-[44rem] text-sm">
                <thead className="bg-background text-muted">
                  <tr>
                    <th className="px-3 py-2 text-start font-medium">{t('col_file')}</th>
                    <th className="px-3 py-2 text-start font-medium">{t('col_domain')}</th>
                    <th className="px-3 py-2 text-start font-medium">{t('col_status')}</th>
                    <th className="px-3 py-2 text-start font-medium">{t('col_rows')}</th>
                    <th className="px-3 py-2 text-start font-medium">{t('col_date')}</th>
                    <th className="px-3 py-2 text-start font-medium"><span className="sr-only">{t('col_actions')}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((job) => {
                    const href = resumeHref(job);
                    return (
                      <tr key={job.id} className="border-t border-border align-top">
                        <td className="max-w-56 px-3 py-2">
                          <span className="block truncate font-medium text-text" dir="ltr" title={job.original_filename}>{job.original_filename}</span>
                          {job.error_message && job.status === 'failed' ? <span className="mt-0.5 block text-xs leading-relaxed text-negative">{job.error_message}</span> : null}
                        </td>
                        <td className="px-3 py-2">{t(`domain_${job.domain}` as 'domain_product_catalog')}</td>
                        <td className="px-3 py-2">
                          <span className="flex flex-wrap gap-1">
                            <Badge tone={STATUS_TONE[job.status]}>{tj(`status_${job.status}` as 'status_ready')}</Badge>
                            {job.parent_job_id ? <Badge tone="muted">{tj('repair_job')}</Badge> : null}
                          </span>
                        </td>
                        <td className="num px-3 py-2">{job.row_count === null ? '—' : `${job.processed_rows} / ${job.row_count}`}</td>
                        <td className="num px-3 py-2 text-muted">{formatDateTime(job.created_at, locale)}</td>
                        <td className="px-3 py-2 text-end">
                          {href ? (
                            <Button asChild variant="outline" size="sm">
                              <Link href={href}>{t('resume')}</Link>
                            </Button>
                          ) : job.status === 'ready' || job.status === 'processing' ? (
                            <span className="text-xs text-muted">{t('resume_from_page')}</span>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination
              page={jobs?.meta?.current_page ?? page}
              lastPage={jobs?.meta?.last_page ?? 1}
              perPage={perPage}
              total={jobs?.meta?.total}
              perPageOptions={PER_PAGE_OPTIONS}
              onPageChange={setPage}
              onPerPageChange={(next) => { setPerPage(next); setPage(1); }}
              disabled={loading}
            />
          </>
        )}
      </section>

      {/* IMP-H8-S4b: سجلّ إجراءات المساعد لمن يملك صلاحية AI Actions؛ الخادم يقرّر ما يُعرض فعلاً (بوابات النوع والفرع). */}
      {hasPermission(user?.permissions, user?.role, 'ai.actions.use') ? <AiActionsHistory /> : null}
    </div>
  );
}
