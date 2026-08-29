'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowRight, ShieldCheck, UserRound } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DocumentPreviewPanel } from '@/components/document-center/document-preview-panel';
import { DraftPreviewDialog } from '@/components/document-center/draft-preview-dialog';
import { ExpenseDraftDialog } from '@/components/document-center/expense-draft-dialog';
import { ExtractedFieldsPanel } from '@/components/document-center/extracted-fields-panel';
import { IssuesWarningsPanel } from '@/components/document-center/issues-warnings-panel';
import { LineItemsPanel } from '@/components/document-center/line-items-panel';
import { MatchingPanel, type MatchCommand } from '@/components/document-center/matching-panel';
import { PurchaseDraftDialog } from '@/components/document-center/purchase-draft-dialog';
import { ReviewChangeDialog } from '@/components/document-center/review-change-dialog';
import { ReviewCommandDialog } from '@/components/document-center/review-command-dialog';
import { ReviewHistoryPanel } from '@/components/document-center/review-history-panel';
import { ReviewStatusBanner } from '@/components/document-center/review-status-banner';
import { ReviewerAssignmentDialog } from '@/components/document-center/reviewer-assignment-dialog';
import { documentFieldTranslationKey, reviewHasVisibleBlocker } from '@/lib/document-review';
import {
  canBuildDocumentDraft,
  canMutateDocumentReview,
  isDocumentReviewMutable,
  linkedTransactionPresentation,
  shouldShowReviewReadinessBlocker,
} from '@/lib/document-review-access';
import type { DocumentReviewPayload, MobileReviewSection, ReviewField } from '@/modules/document-center/contract';

type Command = MatchCommand & { scope: 'review' | 'draft' } | null;

type EditState = {
  fieldLabel: string;
  targetKey: string;
  value: string | number | boolean | null;
} | null;

type Props = {
  batchId: string;
};

function reviewTone(status: string): 'positive' | 'muted' | 'warning' | 'negative' {
  if (status === 'confirmed' || status === 'resolved' || status === 'ready_for_draft' || status === 'draft_created') return 'positive';
  if (status === 'rejected') return 'muted';
  if (status === 'blocking') return 'negative';
  return 'warning';
}

export function ReviewWorkspace({ batchId }: Props) {
  const t = useTranslations('documentCenterReview');
  const [review, setReview] = useState<DocumentReviewPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [command, setCommand] = useState<Command>(null);
  const [edit, setEdit] = useState<EditState>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [draftPreviewOpen, setDraftPreviewOpen] = useState(false);
  const [expenseDraftOpen, setExpenseDraftOpen] = useState(false);
  const [purchaseDraftOpen, setPurchaseDraftOpen] = useState(false);
  const [mobileSection, setMobileSection] = useState<MobileReviewSection>('preview');

  const load = useCallback(async () => {
    try {
      const response = await api<{ data: DocumentReviewPayload }>(`/document-batches/${batchId}/review`);
      setReview(response.data);
      setError(null);
    } catch (exception) {
      setError(exception instanceof ApiError ? exception.message : t('loadFailed'));
    }
  }, [batchId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const hasVisibleBlocker = useMemo(
    () => review ? reviewHasVisibleBlocker(review.matches, review.issues) : true,
    [review],
  );

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
  const canManage = review.capabilities.manage;
  const isReviewMutable = isDocumentReviewMutable(review.batch.status);
  const canMutateReview = canMutateDocumentReview({ canReview, status: review.batch.status });
  const canComplete = canMutateReview && !hasVisibleBlocker;
  const showReadinessBlocker = shouldShowReviewReadinessBlocker({ isReviewMutable, canComplete });
  const linkedTransaction = review.linked_transaction ?? review.linked_purchase;
  const canBuildDraft = canBuildDocumentDraft({
    canBuildDraft: review.capabilities.build_draft,
    documentType: review.batch.document_type,
    status: review.batch.status,
    hasLinkedTransaction: linkedTransaction !== null,
  });
  const activeFile = review.files.find((file) => file.download_available) ?? review.files[0] ?? null;
  const blockingCount = review.issues.filter((i) => i.severity === 'blocking' && ['open', 'reopened'].includes(i.status)).length;
  const warningCount = review.issues.filter((i) => i.severity === 'warning' && ['open', 'reopened'].includes(i.status)).length;

  const sectionItems: Array<{ id: MobileReviewSection; label: string }> = [
    { id: 'preview', label: t('preview') },
    { id: 'details', label: t('details') },
    { id: 'lines', label: t('lineItems') },
    { id: 'matches', label: t('matches') },
    { id: 'issues', label: t('issuesTitle') },
    { id: 'history', label: t('history') },
  ];

  function openDraftFlow() {
    setDraftPreviewOpen(true);
  }

  function confirmDraftCreation() {
    if (!review) return;
    if (review.batch.document_type === 'expense') {
      setExpenseDraftOpen(true);
    } else {
      setPurchaseDraftOpen(true);
    }
  }

  const linkedTransactionState = linkedTransaction ? linkedTransactionPresentation(linkedTransaction.status) : null;
  const linkedActionLabel = linkedTransaction && linkedTransactionState
    ? linkedTransaction.transaction_type === 'expense'
      ? linkedTransactionState.action === 'posted'
        ? t('openPostedExpense', { number: linkedTransaction.transaction_number })
        : linkedTransactionState.action === 'cancelled'
          ? t('openCancelledExpense', { number: linkedTransaction.transaction_number })
          : t('openExpenseDraft', { number: linkedTransaction.transaction_number })
      : linkedTransactionState.action === 'posted'
        ? t('openPostedPurchase', { number: linkedTransaction.transaction_number })
        : linkedTransactionState.action === 'cancelled'
          ? t('openCancelledPurchase', { number: linkedTransaction.transaction_number })
          : t('openPurchaseDraft', { number: linkedTransaction.transaction_number })
    : null;

  const draftButton = linkedTransaction && linkedTransactionState && linkedActionLabel ? (
    <div className="flex flex-wrap items-center gap-2">
      <Button asChild variant="outline">
        <Link href={linkedTransaction.url}>{linkedActionLabel}</Link>
      </Button>
      <Badge tone={reviewTone(linkedTransaction.status)}>{t(linkedTransactionState.badge)}</Badge>
    </div>
  ) : canBuildDraft ? (
    <Button onClick={openDraftFlow}>
      {review.batch.document_type === 'expense' ? t('createExpenseDraft') : t('createPurchaseDraft')}
    </Button>
  ) : null;

  const completionButton = canComplete ? (
    <Button
      onClick={() => setCommand({
        title: t('completeReview'),
        label: t('completeReview'),
        endpoint: `/document-batches/${batchId}/complete-review`,
        scope: 'review',
      })}
    >
      <ShieldCheck className="h-4 w-4" aria-hidden="true" />
      {t('completeReview')}
    </Button>
  ) : null;

  const previewPanel = (
    <Card>
      <CardContent className="py-5">
        <DocumentPreviewPanel
          file={activeFile}
          scanStatus={review.processing_summary?.scan_status}
          processingMessage={review.processing_summary?.processing_message}
        />
      </CardContent>
    </Card>
  );

  const detailsPanel = (
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
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={reviewTone(review.batch.status)}>
                {review.batch.status === 'ready_for_draft'
                  ? t('readyForDraft')
                  : review.batch.status === 'draft_created'
                    ? t('draftCreated')
                    : t('needsReview')}
              </Badge>
              {canManage && (
                <Button size="sm" variant="outline" onClick={() => setAssignOpen(true)}>
                  <UserRound className="h-4 w-4" aria-hidden="true" />
                  {t('assign')}
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
      <ExtractedFieldsPanel
        fields={review.fields}
        canEdit={canMutateReview}
        onEdit={(field: ReviewField) => setEdit({
          fieldLabel: t(documentFieldTranslationKey(field.key)),
          targetKey: `fields.${field.key}`,
          value: field.current,
        })}
      />
    </div>
  );

  const linesPanel = (
    <LineItemsPanel
      lines={review.lines}
      canEdit={canMutateReview}
      onEdit={(target) => setEdit(target)}
    />
  );

  const matchesPanel = (
    <MatchingPanel
      matches={review.matches}
      canMutate={canMutateReview}
      onCommand={(cmd) => setCommand({ ...cmd, scope: 'review' })}
    />
  );

  const issuesPanel = (
    <IssuesWarningsPanel
      issues={review.issues}
      warnings={review.warnings}
      batchId={batchId}
      canMutate={canMutateReview}
      onCommand={(cmd) => setCommand({ ...cmd, scope: 'review' })}
    />
  );

  const historyPanel = <ReviewHistoryPanel history={review.history} />;

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
        <div className="hidden flex-wrap gap-2 md:flex">{draftButton}{completionButton}</div>
      </header>

      <ReviewStatusBanner
        summary={review.processing_summary}
        blockingCount={blockingCount}
        warningCount={warningCount}
        batchId={batchId}
      />

      {showReadinessBlocker && (
        <p className="rounded border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
          {!canReview ? t('notAllowed') : t('readinessBlocked')}
        </p>
      )}

      <div className="hidden grid-cols-1 gap-5 xl:grid-cols-[minmax(0,.95fr)_minmax(0,1.05fr)] lg:grid">
        <div className="space-y-5">{previewPanel}{detailsPanel}{linesPanel}</div>
        <div className="space-y-5">{matchesPanel}{issuesPanel}{historyPanel}</div>
      </div>

      <div className="lg:hidden">
        <div className="grid grid-cols-3 gap-1 rounded border border-border bg-surface p-1 sm:grid-cols-6" role="tablist" aria-label={t('reviewTitle')}>
          {sectionItems.map((section) => (
            <button
              key={section.id}
              type="button"
              role="tab"
              aria-selected={mobileSection === section.id}
              className={`min-h-10 rounded px-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:px-2 ${mobileSection === section.id ? 'bg-primary text-primary-foreground' : 'text-text hover:bg-primary-soft'}`}
              onClick={() => setMobileSection(section.id)}
            >
              {section.label}
            </button>
          ))}
        </div>
        <div className="mt-4">
          {mobileSection === 'preview' && previewPanel}
          {mobileSection === 'details' && detailsPanel}
          {mobileSection === 'lines' && linesPanel}
          {mobileSection === 'matches' && matchesPanel}
          {mobileSection === 'issues' && issuesPanel}
          {mobileSection === 'history' && historyPanel}
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:hidden">
        <div className="flex gap-2">{draftButton}{completionButton}</div>
      </div>

      {command && (command.scope === 'draft' ? canBuildDraft : canMutateReview) && (
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

      <DraftPreviewDialog
        open={draftPreviewOpen}
        onClose={() => setDraftPreviewOpen(false)}
        review={review}
        onConfirm={confirmDraftCreation}
      />

      {expenseDraftOpen && (
        <ExpenseDraftDialog
          open
          onClose={() => setExpenseDraftOpen(false)}
          endpoint={`/document-batches/${batchId}/create-expense-draft`}
          expectedVersion={review.batch.version}
          onSuccess={() => void load()}
          labels={{
            title: t('createExpenseDraft'),
            reason: t('reason'),
            account: t('expenseAccount'),
            category: t('expenseCategory'),
            costCenter: t('expenseCostCenter'),
            paymentMethod: t('expensePaymentMethod'),
            chooseAccount: t('chooseExpenseAccount'),
            noCategory: t('noExpenseCategory'),
            noCostCenter: t('noExpenseCostCenter'),
            cash: t('cash'),
            bank: t('bank'),
            credit: t('credit'),
            cancel: t('cancel'),
            create: t('createExpenseDraft'),
            required: t('expenseDraftRequired'),
            loadOptions: t('expenseDraftHint'),
            optionsFailed: t('expenseOptionsFailed'),
            retry: t('retry'),
            failed: t('saveFailed'),
            stale: t('stale'),
          }}
        />
      )}

      {purchaseDraftOpen && (
        <PurchaseDraftDialog
          open
          onClose={() => setPurchaseDraftOpen(false)}
          endpoint={`/document-batches/${batchId}/create-purchase-draft`}
          expectedVersion={review.batch.version}
          onSuccess={() => void load()}
          labels={{
            title: t('createPurchaseDraft'),
            reason: t('reason'),
            warehouse: t('purchaseWarehouse'),
            costCenter: t('expenseCostCenter'),
            noWarehouse: t('noPurchaseWarehouse'),
            noCostCenter: t('noExpenseCostCenter'),
            cancel: t('cancel'),
            create: t('createPurchaseDraft'),
            required: t('reasonRequired'),
            loadOptions: t('purchaseDraftHint'),
            optionsFailed: t('expenseOptionsFailed'),
            retry: t('retry'),
            failed: t('saveFailed'),
            stale: t('stale'),
          }}
        />
      )}

      {edit && canMutateReview && (
        <ReviewChangeDialog
          open
          batchId={batchId}
          fieldLabel={edit.fieldLabel}
          targetKey={edit.targetKey}
          value={edit.value}
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

      <ReviewerAssignmentDialog
        open={assignOpen}
        onClose={() => setAssignOpen(false)}
        batchId={batchId}
        expectedVersion={review.batch.version}
        currentReviewer={review.batch.reviewer}
        canManage={canManage}
        onSuccess={() => void load()}
      />
    </div>
  );
}
