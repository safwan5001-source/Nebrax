'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { EmptyState, ErrorState, LoadingState, Pagination } from '@/components/nebrax';
import { ApiError } from '@/lib/api';
import { formatDateTime } from '@/lib/formatting';
import {
  AI_ACTION_STATUSES, aiActionHref, fetchAiActions,
  type AiActionHistoryPage, type AiActionStatus,
} from './ai-actions-history';

const TONE: Record<AiActionStatus, 'muted' | 'positive' | 'negative' | 'warning'> = {
  created: 'muted', editing: 'muted', ready_for_approval: 'warning', approved: 'warning', expired: 'muted',
  executing: 'warning', executed: 'positive', partially_failed: 'negative', failed: 'negative', cancelled: 'muted',
};
const PER_PAGE_OPTIONS = [10, 25, 50];

/**
 * سجلّ إجراءات المساعد (IMP-H8-S4b): قراءة فقط من `GET /ai-actions`. يُعرض القسم لمن يملك صلاحية AI Actions (الأب يقرّر)، ورفض الخادم 403 (غير مفعّلة/لا صلاحية)
 * يُعرض «غير متاح» لا خطأً. الفتح يقود إلى شاشة المساعد حيث التفويض الكامل؛ لا إجراء كتابة هنا.
 */
export function AiActionsHistory() {
  const t = useTranslations('importHub');
  const locale = useLocale();
  const [status, setStatus] = useState('');
  const [mine, setMine] = useState(false);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [data, setData] = useState<AiActionHistoryPage | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // آخر طلب يفوز: كل `load()` (من التأثير أو من زر إعادة المحاولة) يأخذ رقماً، وتغيّر المرشّح/الصفحة/التفكيك يُبطل ما سبق، فلا يكتب ردٌّ متأخر فوق نتائج أحدث.
  const latest = useRef(0);

  const load = useCallback(() => {
    const id = ++latest.current;
    setLoading(true);
    setError(null);
    fetchAiActions({ page, perPage, status, mine })
      .then((result) => {
        if (id !== latest.current) return;
        setUnavailable(result.availability === 'unavailable');
        setData(result.page);
      })
      .catch((err) => {
        if (id !== latest.current) return;
        setData(null);
        setError(err instanceof ApiError ? err.message : t('ai_history_failed'));
      })
      .finally(() => {
        if (id === latest.current) setLoading(false);
      });
  }, [page, perPage, status, mine, t]);

  useEffect(() => {
    load();

    return () => {
      latest.current += 1;
    };
  }, [load]);

  const rows = Array.isArray(data?.data) ? data.data : [];

  return (
    <section aria-labelledby="hub-ai-history" className="space-y-2">
      <div className="flex flex-wrap items-end gap-3">
        <h2 id="hub-ai-history" className="me-auto text-sm font-semibold text-text">{t('ai_history_title')}</h2>
        {!unavailable && (
          <>
            <div className="space-y-1">
              <label htmlFor="hub-ai-status" className="block text-xs text-muted">{t('filter_status')}</label>
              <Select id="hub-ai-status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
                <option value="">{t('filter_all')}</option>
                {AI_ACTION_STATUSES.map((value) => (
                  <option key={value} value={value}>{t(`ai_status_${value}`)}</option>
                ))}
              </Select>
            </div>
            <label className="flex items-center gap-2 pb-2 text-xs text-muted">
              <input type="checkbox" checked={mine} onChange={(event) => { setMine(event.target.checked); setPage(1); }} />
              {t('ai_history_mine')}
            </label>
          </>
        )}
      </div>
      <p className="text-xs leading-relaxed text-muted">{t('ai_history_note')}</p>

      {loading ? (
        <LoadingState variant="table" rows={3} />
      ) : unavailable ? (
        <EmptyState title={t('ai_history_unavailable')} description={t('ai_history_unavailable_hint')} />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('ai_history_empty')} description={status || mine ? t('history_empty_filtered') : t('ai_history_empty_hint')} />
      ) : (
        <>
          <div className="overflow-x-auto rounded border border-border bg-surface">
            <table className="w-full min-w-[44rem] text-sm">
              <thead className="bg-background text-muted">
                <tr>
                  <th className="px-3 py-2 text-start font-medium">{t('ai_col_type')}</th>
                  <th className="px-3 py-2 text-start font-medium">{t('col_status')}</th>
                  <th className="px-3 py-2 text-start font-medium">{t('col_rows')}</th>
                  <th className="px-3 py-2 text-start font-medium">{t('ai_col_result')}</th>
                  <th className="px-3 py-2 text-start font-medium">{t('ai_col_by')}</th>
                  <th className="px-3 py-2 text-start font-medium">{t('col_date')}</th>
                  <th className="px-3 py-2 text-start font-medium"><span className="sr-only">{t('col_actions')}</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((item) => {
                  const href = aiActionHref(item.type, item.id);
                  const results = Object.entries(item.execution?.rows ?? {});
                  return (
                    <tr key={item.id} className="border-t border-border align-top">
                      <td className="px-3 py-2" dir="ltr">{item.type}</td>
                      <td className="px-3 py-2"><Badge tone={TONE[item.status] ?? 'muted'}>{t(`ai_status_${item.status}` as 'ai_status_created')}</Badge></td>
                      <td className="num px-3 py-2">{item.summary.row_count ?? '—'}</td>
                      <td className="px-3 py-2 text-xs text-muted">
                        {results.length === 0 ? '—' : results.map(([key, count]) => `${key}: ${count}`).join(' · ')}
                      </td>
                      <td className="px-3 py-2">{item.created_by_name ?? '—'}</td>
                      <td className="num px-3 py-2 text-muted">{item.created_at ? formatDateTime(item.created_at, locale) : '—'}</td>
                      <td className="px-3 py-2 text-end">
                        {href ? (
                          <Button asChild variant="outline" size="sm">
                            <Link href={href}>{t('ai_open')}</Link>
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination
            page={data?.meta.current_page ?? page}
            lastPage={data?.meta.last_page ?? 1}
            perPage={perPage}
            total={data?.meta.total}
            perPageOptions={PER_PAGE_OPTIONS}
            onPageChange={setPage}
            onPerPageChange={(next) => { setPerPage(next); setPage(1); }}
            disabled={loading}
          />
        </>
      )}
    </section>
  );
}
