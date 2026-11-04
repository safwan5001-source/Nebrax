'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Inbox, LockKeyhole, RefreshCw, WifiOff } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import type { StationOpsError, StationOpsErrorKind } from './read-client';

/**
 * UI-0 — حالات الواجهة الصادقة: تحميل / فارغ / صلاحية / انقطاع / خطأ.
 * كل نوع فشل له رسالة تخصه (403 ≠ 404 ≠ انقطاع ≠ شكل غير متوقع) ولا تُعرض أي أرقام معها.
 */

const ICONS: Record<StationOpsErrorKind, typeof AlertTriangle> = {
  unauthorized: LockKeyhole,
  forbidden: LockKeyhole,
  not_found: Inbox,
  offline: WifiOff,
  server: AlertTriangle,
  invalid_shape: AlertTriangle,
  demo: Inbox,
};

function Panel({ icon: Icon, title, body, action, role }: { icon: typeof AlertTriangle; title: string; body?: string; action?: ReactNode; role: 'alert' | 'status' }) {
  return (
    <div role={role} className="flex flex-col items-center gap-2 rounded-xl border border-border bg-surface px-5 py-8 text-center">
      <Icon aria-hidden="true" className="h-7 w-7 text-muted" strokeWidth={1.6} />
      <p className="text-base font-semibold text-text">{title}</p>
      {body ? <p className="max-w-sm text-sm leading-6 text-muted">{body}</p> : null}
      {action}
    </div>
  );
}

export function RetryButton({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations('stationOps');
  return (
    <button
      type="button"
      onClick={onRetry}
      className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-lg border border-[color:var(--fo-control)] bg-surface px-4 text-sm font-medium text-text hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <RefreshCw aria-hidden="true" className="h-4 w-4" strokeWidth={1.7} />
      {t('retry')}
    </button>
  );
}

export function ErrorState({ error, onRetry }: { error: StationOpsError; onRetry?: () => void }) {
  const t = useTranslations('stationOps');
  const retryable = error.kind === 'offline' || error.kind === 'server' || error.kind === 'invalid_shape';
  return (
    <Panel
      role="alert"
      icon={ICONS[error.kind]}
      title={t(`error.${error.kind}.title`)}
      body={t(`error.${error.kind}.body`)}
      action={retryable && onRetry ? <RetryButton onRetry={onRetry} /> : undefined}
    />
  );
}

export function EmptyState({ title, body }: { title: string; body?: string }) {
  return <Panel role="status" icon={Inbox} title={title} body={body} />;
}

export function LoadingBlock({ rows = 3, label }: { rows?: number; label?: string }) {
  const t = useTranslations('stationOps');
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="space-y-3">
      <span className="sr-only">{label ?? t('loading')}</span>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-20 w-full rounded-xl" />
      ))}
    </div>
  );
}

/** نص حالة تحميل/خطأ مضمَّن داخل بطاقة (قسم واحد فاشل لا يُسقط بقية الصفحة). */
export function InlineNote({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'warning' }) {
  return <p className={tone === 'warning' ? 'text-sm leading-6 text-warning' : 'text-sm leading-6 text-muted'}>{children}</p>;
}
