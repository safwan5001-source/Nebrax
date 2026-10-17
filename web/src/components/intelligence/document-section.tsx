'use client';

import { useTranslations } from 'next-intl';
import { FileText, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { gateFor } from '@/modules/intelligence/gate';
import { useIntelligence } from '@/modules/intelligence/store';
import { DocumentProjectionView } from './document-result';
import { StateNotice } from './state-notice';

/**
 * قسم «هذا المستند» داخل لوحة المساعد على شاشة مراجعة مستند. المعرّف يأتي من المسار (UUID) لا من نصّ المستخدم،
 * والقراءة نقرة صريحة، ولا يُرسَل طلب إلا والحالة المقروءة للتوّ `document: ready`. لا شيء يُخزَّن خارج الذاكرة.
 */
export function DocumentSection({ documentId, onNavigate }: { documentId: string; onNavigate: () => void }) {
  const t = useTranslations('intelligence.document');
  const store = useIntelligence();
  const gate = gateFor(store, 'document');
  const canManage = store.status?.abilities.manage_consent === true;
  // نتيجة مستند آخر (قُرئ قبل التنقّل) لا تُعرض هنا أبداً.
  const run = store.documentRun?.documentId === documentId ? store.documentRun : null;

  return (
    <section aria-label={t('section')} data-document-section="" className="space-y-3 rounded-lg border border-border bg-surface p-3">
      <header className="flex items-start gap-2.5">
        <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-primary-soft text-primary">
          <FileText className="h-4 w-4" strokeWidth={1.7} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-text">{t('section')}</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">{t('intro')}</p>
        </div>
        {run ? (
          <Button type="button" variant="ghost" size="icon" className="h-11 w-11 shrink-0 sm:h-8 sm:w-8" aria-label={t('close')} onClick={store.clearDocument}>
            <X className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
          </Button>
        ) : null}
      </header>

      {gate.kind === 'loading' ? (
        <div role="status" aria-busy="true" aria-label={t('reading')} className="space-y-2"><Skeleton className="h-9 w-full" /></div>
      ) : null}
      {gate.kind === 'error' ? <StateNotice notice={gate.error.notice} code={gate.error.code} compact onRetry={() => void store.refreshStatus()} /> : null}
      {gate.kind === 'blocked' ? <StateNotice notice={gate.notice} compact canManageConsent={canManage} onNavigate={onNavigate} /> : null}

      {gate.kind === 'ready' && store.documentError ? (
        <StateNotice
          notice={store.documentError.notice}
          code={store.documentError.code}
          compact
          canManageConsent={canManage}
          onNavigate={onNavigate}
          onRetry={store.documentError.retryable ? () => void store.readDocument(documentId) : undefined}
        />
      ) : null}

      {gate.kind === 'ready' && !run ? (
        <Button
          type="button"
          variant="outline"
          className="h-11 w-full justify-center sm:h-9"
          disabled={store.documentPending}
          onClick={() => void store.readDocument(documentId)}
        >
          {store.documentPending ? t('reading') : t('read')}
        </Button>
      ) : null}

      {gate.kind === 'ready' && store.documentPending && !run ? (
        <div role="status" aria-busy="true" aria-label={t('reading')} className="space-y-2"><Skeleton className="h-16 w-full" /><Skeleton className="h-24 w-full" /></div>
      ) : null}

      {run ? (
        <>
          <DocumentProjectionView projection={run.projection} />
          <Button type="button" variant="ghost" size="sm" className="h-9" disabled={store.documentPending} onClick={() => void store.readDocument(documentId)}>
            <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden="true" />
            {store.documentPending ? t('reading') : t('reread')}
          </Button>
        </>
      ) : null}
    </section>
  );
}
