'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
  CircleAlert, Clock3, Coins, KeyRound, Lock, PlugZap, ServerCrash, ShieldOff, ToggleLeft, WifiOff,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { NoticeKey } from '@/modules/intelligence/state';

const ICONS: Partial<Record<NoticeKey, LucideIcon>> = {
  platform_disabled: ToggleLeft,
  tenant_disabled: ToggleLeft,
  consent_required: KeyRound,
  permission_denied: Lock,
  tool_permission_denied: Lock,
  provider_unavailable: PlugZap,
  external_provider_not_acknowledged: KeyRound,
  currency_unsupported: Coins,
  branch_scope_forbidden: ShieldOff,
  warehouse_scope_forbidden: ShieldOff,
  scope_not_supported: ShieldOff,
  invalid_tool_arguments: CircleAlert,
  invalid_request: CircleAlert,
  budget_not_configured: Coins,
  budget_exceeded: Coins,
  platform_budget_exceeded: Coins,
  pricing_unknown: Coins,
  acknowledgement_required: KeyRound,
  data_category_unavailable: ShieldOff,
  duplicate_request: Clock3,
  rate_limited: Clock3,
  network_error: WifiOff,
  server_error: ServerCrash,
  unknown_error: CircleAlert,
};

/** حالات يملك فيها مالك المؤسسة/مديرها إجراءً مباشراً (إعدادات الموافقة). */
const ADMIN_FIXABLE: ReadonlySet<NoticeKey> = new Set(['tenant_disabled', 'consent_required', 'external_provider_not_acknowledged']);
const ERROR_TONE: ReadonlySet<NoticeKey> = new Set(['network_error', 'server_error', 'unknown_error', 'invalid_request', 'invalid_tool_arguments']);

/**
 * حالة نظام حقيقية بدل نتيجة. المفتاح يأتي من رمز الخادم (`classifyError`) أو من حالة القدرة المحسوبة في الخادم؛
 * لا نصّ هنا يدّعي نتيجة. الإجراء المعروض يعتمد على ما يملكه المستخدم فعلاً (لا رابط يقود إلى 403).
 */
export function StateNotice({
  notice,
  code,
  canManageConsent = false,
  onRetry,
  onNavigate,
  compact = false,
  className,
}: {
  notice: NoticeKey;
  /** رمز الخادم الخام — للتشخيص فقط. */
  code?: string | null;
  canManageConsent?: boolean;
  onRetry?: () => void;
  /** يُستدعى قبل التنقّل من داخل اللوحة لإغلاقها. */
  onNavigate?: () => void;
  compact?: boolean;
  className?: string;
}) {
  const t = useTranslations('intelligence.notice');
  const Icon = ICONS[notice] ?? CircleAlert;
  const isError = ERROR_TONE.has(notice);
  const urgent = isError;

  return (
    <div
      role={urgent ? 'alert' : 'status'}
      data-notice={notice}
      className={cn(
        'flex gap-3 rounded border border-border bg-surface text-start',
        isError ? 'border-negative/40' : 'border-border',
        compact ? 'p-3' : 'p-4',
        className,
      )}
    >
      <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', isError ? 'text-negative' : 'text-warning')} strokeWidth={1.6} aria-hidden="true" />
      <div className="min-w-0 space-y-1.5">
        <p className="text-sm font-medium text-text">{t(`${notice}.title`)}</p>
        <p className="text-sm leading-relaxed text-muted">{t(`${notice}.body`)}</p>
        {code ? (
          <p className="text-[11px] text-muted">
            {t('code')}: <span dir="ltr" className="font-mono">{code}</span>
          </p>
        ) : null}
        {(onRetry || ADMIN_FIXABLE.has(notice)) ? (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {onRetry ? (
              <Button type="button" size="sm" variant="outline" onClick={onRetry}>{t('action_retry')}</Button>
            ) : null}
            {ADMIN_FIXABLE.has(notice) ? (
              canManageConsent ? (
                <Button asChild size="sm" variant="outline">
                  <Link href="/intelligence/settings" onClick={onNavigate}>{t('action_settings')}</Link>
                </Button>
              ) : (
                <span className="text-xs text-muted">{t('action_admin')}</span>
              )
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
