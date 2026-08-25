'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AlertTriangle, ArrowRight, FileText, History, ListChecks, ShieldCheck } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ReviewCommandDialog } from '@/components/document-center/review-command-dialog';
import { ReviewChangeDialog } from '@/components/document-center/review-change-dialog';
import {
  confidencePercentage,
  documentFieldTranslationKey,
  reviewHasVisibleBlocker,
} from '@/lib/document-review';

type ReviewFile = {
  id: string;
  original_name: string;
  mime_type: string | null;
  page_count: number | null;
  download_available: boolean;
};

type ReviewField = {
  key: string;
  original: string | number | boolean | null;
  current: string | number | boolean | null;
  confidence_basis_points?: number;
  page?: number;
};

type Candidate = {
  id: string;
  label: string;
  candidate_type: string;
  name?: string;
  sku?: string;
  unit?: string;
  score_basis_points: number;
  strategy: string;
  is_active: boolean;
};

type Match = {
  id: string;
  subject_key: string;
  status: string;
  score_basis_points: number;
  strategy: string;
  candidates: Candidate[];
};

type Issue = {
  id: string;
  code: string;
  severity: string;
  status: string;
  safe_message: string;
  subject_key: string | null;
};

type ReviewHistory = {
  id: string;
  action: string;
  reason: string | null;
  before: Record<string, string | number | boolean> | null;
  after: Record<string, string | number | boolean> | null;
  actor: { id: string; name: string } | null;
  occurred_at: string | null;
};

type Review = {
  batch: {
    id: string;
    status: string;
    version: number;
    reviewer: { id: string; name: string } | null;
  };
  fields: ReviewField[];
  files: ReviewFile[];
  matches: Match[];
  issues: Issue[];
  history: ReviewHistory[];
  capabilities: { view: boolean; review: boolean; manage: boolean };
};

type Command = {
  title: string;
  label: string;
  endpoint: string;
  payload?: Record<string, unknown>;
} | null;

type MobileSection = 'details' | 'matches' | 'issues' | 'history';

function reviewTone(status: string): 'positive' | 'muted' | 'warning' | 'negative' {
  if (status === 'confirmed' || status === 'resolved' || status === 'ready_for_draft') return 'positive';
  if (status === 'rejected') return 'muted';
  if (status === 'blocking') return 'negative';
  return 'warning';
}

function readableValue(value: ReviewField['current']): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? '✓' : '—';

  return String(value);
}

function auditValue(value: Record<string, string | number | boolean> | null): string {
  if (!value || Object.keys(value).length === 0) return '—';

  return Object.entries(value).map(([key, item]) => `${key}: ${item}`).join(' · ');
}

export default function DocumentReviewPage() {
  const t = useTranslations('documentCenterReview');
  const { id } = useParams<{ id: string }>();
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [command, setCommand] = useState<Command>(null);
  const [edit, setEdit] = useState<ReviewField | null>(null);
  const [mobileSection, setMobileSection] = useState<MobileSection>('details');
  const [previewError, setPreviewError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await api<{ data: Review }>(`/document-batches/${id}/review`);
      setReview(response.data);
      setError(null);
    } catch (exception) {
      setError(exception instanceof ApiError ? exception.message : t('loadFailed'));
    }
  }, [id, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const hasVisibleBlocker = useMemo(
    () => review ? reviewHasVisibleBlocker(review.matches, review.issues) : true,
    [review],
  );

  async function preview(file: ReviewFile) {
    if (!file.download_available) return;

    try {
      setPreviewError(null);
      const response = await api<{ url: string }>(`/document-files/${file.id}/download-url`);
      window.open(response.url, '_blank', 'noopener,noreferrer');
    } catch (exception) {
      setPreviewError(exception instanceof ApiError ? exception.message : t('unavailable'));
    }
  }

  if (error) {
    return (
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 py-10 text-sm text-muted">
          {error}
          <Button onClick={() => void load()}>{t('retry')}</Button>
        </CardContent>
      </Card>
    );
  }

  if (!review) {
    return <Card><CardContent className="py-10 text-sm text-muted">{t('loading')}</CardContent></Card>;
  }

  const canReview = review.capabilities.review;
  const canComplete = canReview && review.batch.status !== 'ready_for_draft' && !hasVisibleBlocker;
  const activeFile = review.files.find((file) => file.download_available) ?? review.files[0];
  const sectionItems: Array<{ id: MobileSection; label: string }> = [
    { id: 'details', label: t('details') },
    { id: 'matches', label: t('matches') },
    { id: 'issues', label: t('issuesTitle') },
    { id: 'history', label: t('history') },
  ];

  const completionButton = (
    <Button
      onClick={() => setCommand({
        title: t('completeReview'),
        label: t('completeReview'),
        endpoint: `/document-batches/${id}/complete-review`,
      })}
      disabled={!canComplete}
      title={!canReview ? t('notAllowed') : hasVisibleBlocker ? t('readinessBlocked') : undefined}
    >
      <ShieldCheck className="h-4 w-4" aria-hidden="true" />
      {t('completeReview')}
    </Button>
  );

  const details = (
    <div className="space-y-5">
      <Card>
        <CardContent className="space-y-4 py-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold text-text">{t('document')}</h2>
              <p className="mt-1 text-sm text-muted">
                {t('reviewer')}: {review.batch.reviewer?.name ?? t('notAssigned')}
              </p>
            </div>
            <Badge tone={reviewTone(review.batch.status)}>
              {review.batch.status === 'ready_for_draft' ? t('readyForDraft') : t('needsReview')}
            </Badge>
          </div>
          {activeFile ? (
            <div className="rounded border border-border bg-surface p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium text-text">{activeFile.original_name}</p>
                  <p className="mt-1 text-xs text-muted">
                    {activeFile.mime_type ?? t('unavailable')}
                    {activeFile.page_count ? ` · ${t('page', { page: activeFile.page_count })}` : ''}
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => void preview(activeFile)} disabled={!activeFile.download_available}>
                  <FileText className="h-4 w-4" aria-hidden="true" />
                  {t('preview')}
                </Button>
              </div>
              {!activeFile.download_available && <p className="mt-2 text-xs text-muted">{t('unavailable')}</p>}
              {previewError && <p role="alert" className="mt-2 text-xs text-negative">{previewError}</p>}
            </div>
          ) : (
            <p className="text-sm text-muted">{t('noPreview')}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="py-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold text-text">{t('data')}</h2>
            <span className="text-xs text-muted">{t('evidence')}</span>
          </div>
          {review.fields.length === 0 ? (
            <p className="mt-4 text-sm text-muted">{t('noFields')}</p>
          ) : (
            <dl className="mt-4 grid gap-3 sm:grid-cols-2">
              {review.fields.map((field) => {
                const confidence = confidencePercentage(field.confidence_basis_points);
                const label = t(documentFieldTranslationKey(field.key));

                return (
                  <div key={field.key} className="rounded border border-border p-3">
                    <dt className="text-sm font-medium text-text">{label}</dt>
                    <dd className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                      <div>
                        <span className="text-xs text-muted">{t('originalValue')}</span>
                        <p className="mt-1 break-words font-mono text-text">{readableValue(field.original)}</p>
                      </div>
                      <div>
                        <span className="text-xs text-muted">{t('reviewedValue')}</span>
                        <p className="mt-1 break-words font-mono text-text">{readableValue(field.current)}</p>
                      </div>
                    </dd>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs text-muted">
                        {confidence !== null ? t('score', { score: confidence }) : '—'}
                        {field.page ? ` · ${t('page', { page: field.page })}` : ''}
                      </span>
                      <Button size="sm" variant="outline" onClick={() => setEdit(field)} disabled={!canReview} title={!canReview ? t('notAllowed') : undefined}>
                        {t('edit')}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </dl>
          )}
        </CardContent>
      </Card>
    </div>
  );

  const matches = (
    <Card>
      <CardContent className="py-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold text-text">{t('matches')}</h2>
          <ListChecks className="h-5 w-5 text-muted" aria-hidden="true" />
        </div>
        {review.matches.length === 0 ? (
          <p className="mt-4 text-sm text-muted">{t('noMatches')}</p>
        ) : (
          <div className="mt-4 space-y-4">
            {review.matches.map((match) => (
              <article key={match.id} className="rounded border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium text-text">{t(documentFieldTranslationKey(match.subject_key))}</p>
                    <p className="mt-1 text-xs text-muted">{match.strategy} · {t('score', { score: confidencePercentage(match.score_basis_points) ?? 0 })}</p>
                  </div>
                  <Badge tone={reviewTone(match.status)}>{t(match.status as 'confirmed' | 'suggested' | 'rejected')}</Badge>
                </div>
                <div className="mt-3 space-y-2">
                  {match.candidates.map((candidate) => (
                    <div key={candidate.id} className="rounded border border-border bg-surface p-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="font-medium text-text">{candidate.label}</p>
                          <p className="mt-1 text-xs text-muted">
                            {[candidate.sku, candidate.unit, candidate.strategy].filter(Boolean).join(' · ')}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge tone={candidate.is_active ? 'neutral' : 'muted'}>{t('score', { score: confidencePercentage(candidate.score_basis_points) ?? 0 })}</Badge>
                          <Button
                            size="sm"
                            onClick={() => setCommand({
                              title: t('confirm'),
                              label: t('confirm'),
                              endpoint: `/document-match-results/${match.id}/confirm`,
                              payload: { candidate_id: candidate.id },
                            })}
                            disabled={!canReview || !candidate.is_active}
                            title={!candidate.is_active ? t('inactiveCandidate') : !canReview ? t('notAllowed') : undefined}
                          >
                            {t('confirm')}
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-3">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setCommand({
                      title: t('reject'),
                      label: t('reject'),
                      endpoint: `/document-match-results/${match.id}/reject`,
                    })}
                    disabled={!canReview}
                    title={!canReview ? t('notAllowed') : undefined}
                  >
                    {t('reject')}
                  </Button>
                </div>
              </article>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );

  const issues = (
    <Card>
      <CardContent className="py-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold text-text">{t('issuesTitle')}</h2>
          <AlertTriangle className="h-5 w-5 text-warning" aria-hidden="true" />
        </div>
        {review.issues.length === 0 ? (
          <p className="mt-4 text-sm text-muted">{t('noIssues')}</p>
        ) : (
          <div className="mt-4 space-y-3">
            {review.issues.map((issue) => {
              const isBlockingTaxIssue = issue.severity === 'blocking' && issue.code.startsWith('tax_');
              const action = isBlockingTaxIssue ? 'revalidateFinancial' : issue.status === 'resolved' ? 'reopen' : 'resolve';
              const endpoint = isBlockingTaxIssue
                ? `/document-batches/${review.batch.id}/revalidate-financial`
                : `/document-issues/${issue.id}/${action}`;

              return (
                <article key={issue.id} className="rounded border border-border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-text">{issue.code}</p>
                      <p className="mt-1 text-sm text-muted">{issue.safe_message}</p>
                    </div>
                    <Badge tone={issue.severity === 'blocking' ? 'negative' : 'warning'}>{t(issue.severity as 'blocking' | 'warning')}</Badge>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <Badge tone={reviewTone(issue.status)}>{t(issue.status as 'open' | 'resolved')}</Badge>
                    <Button
                      size="sm"
                      onClick={() => setCommand({
                        title: t(action),
                        label: t(action),
                        endpoint,
                      })}
                      disabled={!canReview}
                      title={!canReview ? t('notAllowed') : undefined}
                    >
                      {t(action)}
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );

  const history = (
    <Card>
      <CardContent className="py-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold text-text">{t('history')}</h2>
          <History className="h-5 w-5 text-muted" aria-hidden="true" />
        </div>
        {review.history.length === 0 ? (
          <p className="mt-4 text-sm text-muted">{t('noHistory')}</p>
        ) : (
          <ol className="mt-4 space-y-3">
            {review.history.map((event) => (
              <li key={event.id} className="rounded border border-border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-text">{event.action}</span>
                  <time className="font-mono text-xs text-muted">{event.occurred_at ?? '—'}</time>
                </div>
                <p className="mt-2 text-muted">{event.actor?.name ?? '—'} · {event.reason ?? '—'}</p>
                <p className="mt-2 text-xs text-muted">{t('originalValue')}: {auditValue(event.before)}</p>
                <p className="mt-1 text-xs text-muted">{t('reviewedValue')}: {auditValue(event.after)}</p>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-5 pb-28 md:pb-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Button asChild variant="ghost" size="sm">
            <Link href="/documents"><ArrowRight className="h-4 w-4" aria-hidden="true" />{t('back')}</Link>
          </Button>
          <h1 className="mt-2 text-xl font-semibold text-text">{t('reviewTitle')}</h1>
          <p className="mt-1 font-mono text-xs text-muted">{t('version', { version: review.batch.version })}</p>
        </div>
        <div className="hidden md:block">{completionButton}</div>
      </header>

      {!canComplete && review.batch.status !== 'ready_for_draft' && (
        <p className="rounded border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">{!canReview ? t('notAllowed') : t('readinessBlocked')}</p>
      )}

      <div className="hidden grid-cols-1 gap-5 xl:grid-cols-[minmax(0,.9fr)_minmax(0,1.1fr)] md:grid">
        <div>{details}</div>
        <div className="space-y-5">{matches}{issues}{history}</div>
      </div>

      <div className="md:hidden">
        <div className="grid grid-cols-4 gap-1 rounded border border-border bg-surface p-1" role="tablist" aria-label={t('reviewTitle')}>
          {sectionItems.map((section) => (
            <button
              key={section.id}
              type="button"
              role="tab"
              aria-selected={mobileSection === section.id}
              className={`min-h-10 rounded px-2 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${mobileSection === section.id ? 'bg-primary text-primary-foreground' : 'text-text hover:bg-primary-soft'}`}
              onClick={() => setMobileSection(section.id)}
            >
              {section.label}
            </button>
          ))}
        </div>
        <div className="mt-4">
          {mobileSection === 'details' && details}
          {mobileSection === 'matches' && matches}
          {mobileSection === 'issues' && issues}
          {mobileSection === 'history' && history}
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:hidden">
        {completionButton}
      </div>

      {command && (
        <ReviewCommandDialog
          open
          onClose={() => setCommand(null)}
          title={command.title}
          confirmLabel={command.label}
          endpoint={command.endpoint}
          expectedVersion={review.batch.version}
          payload={command.payload}
          staleMessage={t('stale')}
          labels={{
            reason: t('reasonPlaceholder'),
            cancel: t('cancel'),
            required: t('reasonRequired'),
            failed: t('saveFailed'),
          }}
          onSuccess={() => void load()}
        />
      )}

      {edit && (
        <ReviewChangeDialog
          open
          batchId={id}
          fieldLabel={t(documentFieldTranslationKey(edit.key))}
          targetKey={`fields.${edit.key}`}
          value={edit.current}
          expectedVersion={review.batch.version}
          onClose={() => setEdit(null)}
          onSuccess={() => void load()}
          labels={{
            title: t('edit'),
            fieldValue: t('fieldValue'),
            save: t('save'),
            cancel: t('cancel'),
            reason: t('reason'),
            reasonPlaceholder: t('reasonPlaceholder'),
            reasonRequired: t('reasonRequired'),
            saveFailed: t('saveFailed'),
            stale: t('stale'),
          }}
        />
      )}
    </div>
  );
}
