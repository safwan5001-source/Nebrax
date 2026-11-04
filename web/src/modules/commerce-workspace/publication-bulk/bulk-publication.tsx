'use client';

import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Select } from '@/components/ui/select';
import { commerceWorkspaceMessage } from '@/modules/commerce-workspace/messages';
import type { BulkPublicationAction, BulkPublicationResult } from '@/modules/products/publication';
import { fillTemplate, type Selection } from './selection';

type MessageKey = Parameters<typeof commerceWorkspaceMessage>[1];
type T = (key: MessageKey) => string;

export type BulkStoreOption = { id: string; name: string };

/** شريط الإجراءات الجماعية: يظهر فقط حين يوجد تحديد؛ لاصق أسفل الشاشة على الجوال. */
export function BulkActionBar({
  t,
  selection,
  pageIds,
  storefrontOptions,
  targetStoreId,
  onTargetStoreChange,
  busy,
  notice,
  idPrefix,
  onAction,
  onClear,
}: {
  t: T;
  selection: Selection;
  pageIds: readonly string[];
  storefrontOptions: BulkStoreOption[];
  targetStoreId: string;
  onTargetStoreChange: (id: string) => void;
  busy: boolean;
  /** إشعار عابر (سقف التحديد / إلغاء التحديد لتغيّر الاستعلام). */
  notice: string | null;
  idPrefix: string;
  onAction: (action: BulkPublicationAction) => void;
  onClear: () => void;
}) {
  const total = selection.size;
  if (total === 0 && !notice) return null;

  const onPage = pageIds.filter((id) => selection.has(id)).length;
  const offPage = total - onPage;
  const multiStore = storefrontOptions.length > 1;
  const needsStore = storefrontOptions.length === 0 || (multiStore && !targetStoreId);
  const actionsDisabled = busy || total === 0 || needsStore;

  return (
    <section
      role="region"
      aria-label={t('bulkRegion')}
      className="sticky bottom-0 z-10 flex flex-col gap-3 rounded border border-border bg-surface p-3 shadow-sm md:static"
    >
      {notice ? (
        <p role="status" className="text-xs text-muted">
          {notice}
        </p>
      ) : null}
      {total > 0 ? (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <p className="text-sm font-semibold text-text" data-testid="bulk-selected-count">
              {fillTemplate(t('bulkSelectedCount'), { n: total })}
            </p>
            <p className="text-xs text-muted">
              {fillTemplate(t('bulkSelectedOnPage'), { n: onPage })}
              {offPage > 0 ? ` · ${fillTemplate(t('bulkSelectedOffPage'), { n: offPage })}` : ''}
            </p>
            <Button type="button" variant="outline" size="sm" onClick={onClear} disabled={busy}>
              {t('bulkClear')}
            </Button>
          </div>
          <p className="text-xs text-muted">{t('bulkScopeHint')}</p>

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
            {multiStore ? (
              <div className="min-w-0 sm:w-56">
                <label htmlFor={`${idPrefix}-bulk-store`} className="mb-1 block text-xs font-medium text-muted">
                  {t('bulkTargetStoreLabel')}
                </label>
                <Select
                  id={`${idPrefix}-bulk-store`}
                  value={targetStoreId}
                  onChange={(event) => onTargetStoreChange(event.target.value)}
                  disabled={busy}
                  className="h-10 bg-surface"
                >
                  <option value="">{t('bulkTargetStoreChoose')}</option>
                  {storefrontOptions.map((store) => (
                    <option key={store.id} value={store.id}>
                      {store.name}
                    </option>
                  ))}
                </Select>
              </div>
            ) : null}
            <Button
              type="button"
              className="w-full sm:w-auto"
              disabled={actionsDisabled}
              onClick={() => onAction('publish')}
            >
              {t('bulkPublish')}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              disabled={actionsDisabled}
              onClick={() => onAction('unpublish')}
            >
              {t('bulkUnpublish')}
            </Button>
          </div>
          {needsStore && multiStore ? <p className="text-xs text-muted">{t('bulkNeedStore')}</p> : null}
        </>
      ) : null}
    </section>
  );
}

export type BulkDialogState =
  | { phase: 'closed' }
  | { phase: 'confirm'; action: BulkPublicationAction; storeName: string; items: Array<{ id: string; name: string }> }
  | { phase: 'running'; action: BulkPublicationAction; storeName: string; items: Array<{ id: string; name: string }> }
  | {
      phase: 'result';
      action: BulkPublicationAction;
      storeName: string;
      items: Array<{ id: string; name: string }>;
      /** null = تعذّر الطلب نفسه (الحالة الفعلية غير مؤكدة). */
      result: BulkPublicationResult | null;
    };

const PREVIEW_NAMES = 5;

/** حوار التأكيد → التنفيذ → تقرير النتيجة (نجاح كلي/جزئي بأسماء المرفوض والفاشل). */
export function BulkDialog({
  t,
  nounLabel,
  state,
  onConfirm,
  onClose,
}: {
  t: T;
  nounLabel: string;
  state: BulkDialogState;
  onConfirm: () => void;
  onClose: () => void;
}) {
  if (state.phase === 'closed') return null;

  const publish = state.action === 'publish';

  if (state.phase === 'confirm' || state.phase === 'running') {
    const running = state.phase === 'running';
    const preview = state.items.slice(0, PREVIEW_NAMES);
    const rest = state.items.length - preview.length;
    return (
      <Dialog
        open
        onClose={running ? () => {} : onClose}
        hideClose={running}
        title={publish ? t('bulkConfirmPublishTitle') : t('bulkConfirmUnpublishTitle')}
      >
        <p className="text-sm leading-relaxed text-text">
          {fillTemplate(publish ? t('bulkConfirmPublishBody') : t('bulkConfirmUnpublishBody'), {
            n: state.items.length,
            noun: nounLabel,
            store: state.storeName,
          })}
        </p>
        <ul className="mt-3 space-y-0.5 text-xs text-muted">
          {preview.map((item) => (
            <li key={item.id}>
              <bdi>{item.name}</bdi>
            </li>
          ))}
          {rest > 0 ? <li>{fillTemplate(t('bulkMoreItems'), { n: rest })}</li> : null}
        </ul>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onClose} disabled={running}>
            {t('bulkCancel')}
          </Button>
          <Button type="button" variant={publish ? 'primary' : 'danger'} onClick={onConfirm} disabled={running}>
            {running ? t('bulkRunning') : publish ? t('bulkConfirmPublish') : t('bulkConfirmUnpublish')}
          </Button>
        </div>
      </Dialog>
    );
  }

  // result
  const { result } = state;
  const names = new Map(state.items.map((item) => [item.id, item.name]));
  const problems = result?.results.filter((entry) => entry.status === 'rejected' || entry.status === 'failed') ?? [];
  const clean = result !== null && problems.length === 0;

  return (
    <Dialog open onClose={onClose} title={t('bulkResultTitle')}>
      <div role="status" className="space-y-3 text-sm text-text">
        {result === null ? (
          <p>{t('bulkRequestFailed')}</p>
        ) : (
          <>
            <p className="font-medium">{clean ? t('bulkResultAllOk') : t('bulkResultPartial')}</p>
            <ul className="space-y-0.5 text-xs">
              <li>{fillTemplate(t('bulkResultUpdated'), { n: result.summary.updated })}</li>
              <li>{fillTemplate(t('bulkResultUnchanged'), { n: result.summary.unchanged })}</li>
              {result.summary.rejected > 0 ? (
                <li>{fillTemplate(t('bulkResultRejected'), { n: result.summary.rejected })}</li>
              ) : null}
              {result.summary.failed > 0 ? (
                <li>{fillTemplate(t('bulkResultFailed'), { n: result.summary.failed })}</li>
              ) : null}
            </ul>
            {problems.length > 0 ? (
              <ul className="max-h-40 space-y-1 overflow-auto rounded border border-border p-2 text-xs">
                {problems.map((entry) => (
                  <li key={entry.id}>
                    <bdi className="font-medium">{names.get(entry.id) ?? entry.id}</bdi>
                    {' — '}
                    {entry.reason === 'not_found' ? t('bulkReasonNotFound') : t('bulkReasonError')}
                  </li>
                ))}
              </ul>
            ) : null}
            {result.summary.failed > 0 ? <p className="text-xs text-muted">{t('bulkResultFailedKept')}</p> : null}
          </>
        )}
      </div>
      <div className="mt-5 flex justify-end">
        <Button type="button" onClick={onClose}>
          {t('bulkClose')}
        </Button>
      </div>
    </Dialog>
  );
}
