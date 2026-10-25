'use client';

import { useId, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Check, ChevronDown, Copy, History, KeyRound, Pause, Pencil, Play, ShieldCheck, ShieldOff, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { resolveApiUrl } from '@/lib/api';
import { formatDateTime } from '@/lib/formatting';
import { formatRiyal, minorToRiyal } from '@/lib/money';
import { PaymentBrandMark } from '@/components/payments/payment-brand-mark';
import { paymentBrandPresentation } from '@/lib/payment-brand-registry';
import {
  activationBlock,
  availableActions,
  gatewayDisplayName,
  statusTone,
  type GatewayAction,
  type GatewayConnection,
} from '@/modules/payments/gateways/contract';

const ICONS: Record<GatewayAction, typeof Pencil> = {
  edit: Pencil, rotate: KeyRound, verify: ShieldCheck, activate: Play, suspend: Pause, revoke: ShieldOff, delete: Trash2, events: History,
};

/**
 * تفاصيل اتصال بوابة (PAY-SETTINGS-UX): الإعدادات التقنية المتقدمة داخل البوابة نفسها، في ستة أقسام.
 * **لا حالة هنا تُخزَّن**: كل ما يُعرض مرآة لاستجابة `/payment-gateways` (والأفعال تمرّ إلى الصفحة الأم لتستدعي الواجهات القائمة ذاتها).
 * ما لا إعداد حقيقياً له (سياسة التقاط/تسوية/مزامنة يدوية) يُعلَن «غير متاح» ولا يُحاكى بمفتاح. لا سرّ يُعرض؛ مفتاح استقبال webhook للمدير فقط.
 */
export function GatewayDetailSheet({
  connection,
  canManage,
  busy,
  onClose,
  onAction,
}: {
  connection: GatewayConnection | null;
  canManage: boolean;
  busy: boolean;
  onClose: () => void;
  onAction: (connection: GatewayConnection, action: GatewayAction) => void;
}) {
  if (!connection) return null;
  // مفتاح بالاتصال: فتح اتصال آخر يعيد أقسام الطيّ إلى وضعها الافتراضي.
  return <DetailBody key={connection.id} connection={connection} canManage={canManage} busy={busy} onClose={onClose} onAction={onAction} />;
}

/** القسم المفتوح افتراضياً: الحالة والاتصال (فيه التفعيل/الإيقاف)؛ الباقي مطويّ ويُفتح بنقرة، ولا يُركَّب محتواه مطويّاً. */
const DEFAULT_OPEN = [1];

function DetailBody({
  connection,
  canManage,
  busy,
  onClose,
  onAction,
}: {
  connection: GatewayConnection;
  canManage: boolean;
  busy: boolean;
  onClose: () => void;
  onAction: (connection: GatewayConnection, action: GatewayAction) => void;
}) {
  const t = useTranslations('paymentGateways');
  const d = useTranslations('paymentGateways.detail');
  const locale = useLocale();
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState<number[]>(DEFAULT_OPEN);
  const uid = useId();
  const c = connection;
  const toggle = (n: number) => setOpen((cur) => (cur.includes(n) ? cur.filter((x) => x !== n) : [...cur, n]));
  const actions = availableActions(c, canManage);
  const blocked = activationBlock(c) !== null;
  const caps = c.provider_capabilities ?? null;
  const heading = (n: number) => `${uid}-h${n}`;
  const hasAdapter = caps !== null;

  function btn(action: GatewayAction) {
    if (!actions.includes(action)) return null;
    const Icon = ICONS[action];
    const isBlocked = action === 'activate' && blocked;
    return (
      <Button
        key={action}
        size="sm"
        variant={action === 'revoke' || action === 'delete' ? 'ghost' : 'outline'}
        disabled={busy || isBlocked}
        title={isBlocked ? t('activationBlocked') : undefined}
        onClick={() => onAction(c, action)}
      >
        <Icon className={`h-3.5 w-3.5 ${action === 'revoke' || action === 'delete' ? 'text-negative' : ''}`} strokeWidth={1.7} aria-hidden="true" />
        {t(`actions.${action}`)}
      </Button>
    );
  }

  const webhookUrl = hasAdapter && c.webhook_key ? resolveApiUrl(`payment-webhooks/${c.provider}/${c.webhook_key}`) : null;

  async function copyWebhook() {
    if (!webhookUrl) return;
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent closeLabel={t('close')} className="sm:max-w-xl" data-testid="pg-detail">
        <div className="space-y-1 border-b border-border p-4 pe-14">
          <SheetTitle className="text-base font-semibold">{gatewayDisplayName(c, locale)}</SheetTitle>
          <SheetDescription className="text-xs text-muted">{d('description')}</SheetDescription>
          {!canManage && <p role="note" className="text-xs text-muted" data-testid="pg-detail-readonly">{d('readOnly')}</p>}
        </div>
        <div className="flex-1 space-y-2.5 overflow-y-auto p-4">
          {/* 1 — عام وحالة الاتصال */}
          <Section id={heading(1)} title={d('general.title')} open={open.includes(1)} onToggle={() => toggle(1)}>
            <div className="flex flex-wrap gap-1.5">
              <Badge tone={c.environment === 'live' ? 'neutral' : 'muted'}>{t(`environments.${c.environment}`)}</Badge>
              <Badge tone={statusTone(c.status)}>{t(`status.${c.status}`)}</Badge>
              <Badge tone={c.is_usable ? 'positive' : 'muted'}>{c.is_usable ? d('general.usable') : d('general.notUsable')}</Badge>
            </div>
            <Rows>
              <Row label={d('general.provider')}>{t(`providers.${c.provider}`)}</Row>
              <Row label={d('general.activatedAt')}>{c.activated_at ? formatDateTime(c.activated_at, locale) : d('general.never')}</Row>
              <Row label={d('general.createdAt')}>{c.created_at ? formatDateTime(c.created_at, locale) : '—'}</Row>
            </Rows>
            {blocked && c.status !== 'revoked' && <Note tone="warning">{t('activationBlocked')}</Note>}
            <Actions>{btn('activate')}{btn('suspend')}</Actions>
          </Section>

          {/* 2 — المفاتيح والبيئة والتحقق */}
          <Section id={heading(2)} title={d('keys.title')} open={open.includes(2)} onToggle={() => toggle(2)}>
            <Rows>
              <Row label={d('keys.environment')}>{t(`environments.${c.environment}`)}</Row>
              <Row label={t('fields.secretKey')}>{c.has_secret_key ? t('fields.saved') : t('fields.missing')}</Row>
              {c.publishable_key && <Row label={d('keys.publishable')}><bdi dir="ltr" className="break-all">{c.publishable_key}</bdi></Row>}
              <Row label={t('fields.verified')}>{c.verified_at ? formatDateTime(c.verified_at, locale) : t('fields.notVerified')}</Row>
            </Rows>
            <Note>{d('keys.note')}</Note>
            <Actions>{btn('edit')}{btn('verify')}</Actions>
          </Section>

          {/* 3 — دعم الوسائل الفعلي */}
          <Section id={heading(3)} title={d('methods.title')} open={open.includes(3)} onToggle={() => toggle(3)}>
            {hasAdapter ? (
              <>
                <ul className="space-y-1.5" data-testid="pg-detail-methods">
                  {caps.methods.map((m) => {
                    const needsSetup = caps.methods_requiring_provider_setup.includes(m);
                    const brand = paymentBrandPresentation(m);
                    return (
                      <li key={m} className="flex flex-wrap items-center justify-between gap-2 rounded border border-border px-3 py-2">
                        {brand ? <PaymentBrandMark brand={brand} /> : <span className="text-sm font-semibold text-text">{m}</span>}
                        <Badge tone={needsSetup ? 'warning' : 'positive'}>{needsSetup ? d('methods.providerSetup') : d('methods.declared')}</Badge>
                      </li>
                    );
                  })}
                </ul>
                <Note>{d('methods.note')}</Note>
              </>
            ) : (
              <Note tone="warning">{d('methods.noAdapter')}</Note>
            )}
          </Section>

          {/* 4 — Webhooks والأحداث والمزامنة */}
          <Section id={heading(4)} title={d('webhooks.title')} open={open.includes(4)} onToggle={() => toggle(4)}>
            <Rows>
              <Row label={t('fields.webhookSecret')}>{c.has_webhook_secret ? t('fields.saved') : t('fields.missing')}</Row>
            </Rows>
            {webhookUrl ? (
              <div className="space-y-1.5">
                <p className="text-xs text-muted">{d('webhooks.url')}</p>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                  <code dir="ltr" className="block min-w-0 flex-1 rounded bg-primary-soft/40 px-2 py-1.5 text-start font-mono text-xs text-text [overflow-wrap:anywhere]" data-testid="pg-webhook-url">{webhookUrl}</code>
                  <Button size="sm" variant="outline" className="self-start" onClick={() => void copyWebhook()} aria-label={d('webhooks.copy')}>
                    {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
                    {copied ? d('webhooks.copied') : d('webhooks.copy')}
                  </Button>
                </div>
              </div>
            ) : hasAdapter ? (
              <Note>{d('webhooks.managerOnly')}</Note>
            ) : (
              <Note>{d('webhooks.noAdapter')}</Note>
            )}
            <Note>{d('webhooks.syncUnavailable')}</Note>
          </Section>

          {/* 5 — الالتقاط والاستردادات والتسويات */}
          <Section id={heading(5)} title={d('money.title')} open={open.includes(5)} onToggle={() => toggle(5)}>
            {hasAdapter ? (
              <Rows>
                <Row label={d('money.capture')}>{caps.hosted_checkout ? d('money.hosted') : d('money.notHosted')}</Row>
                <Row label={d('money.refunds')}>{caps.refunds ? d('money.refundsYes') : d('money.refundsNo')}</Row>
                <Row label={d('money.currencies')}><bdi dir="ltr">{caps.currencies.join(', ') || '—'}</bdi></Row>
                <Row label={d('money.minAmount')}><bdi dir="ltr">{formatRiyal(minorToRiyal(caps.min_amount_minor))}</bdi></Row>
              </Rows>
            ) : (
              <Note>{d('money.noAdapter')}</Note>
            )}
            {/* سياسة ضريبة الرسوم إعداد للاتصال نفسه لا للمحوّل: تُعرض دائماً (كانت على البطاقة قبل تبسيطها). */}
            <Rows>
              <Row label={t('fields.feeTaxPolicy')}>
                <span data-testid="pg-fee-tax">
                  {c.fee_tax_policy === 'input_vat' ? t(c.fee_tax_opinion_recorded ? 'fields.feeTaxInputVat' : 'fields.feeTaxInputVatNoOpinion') : t('fields.feeTaxReject')}
                </span>
              </Row>
            </Rows>
            <Note>{d('money.policyUnavailable')}</Note>
            <p className="text-xs">
              <Link href="/payments/online" className="text-primary underline-offset-2 hover:underline">{d('money.openOps')}</Link>
            </p>
          </Section>

          {/* 6 — الأمان وتدوير الأسرار وسجل التدقيق */}
          <Section id={heading(6)} title={d('security.title')} open={open.includes(6)} onToggle={() => toggle(6)}>
            <Rows>
              <Row label={t('fields.credentialVersion')}><span className="num">{c.credential_version}</span></Row>
              {c.previous_secret_valid_until && <Row label={t('fields.graceUntil')}><span className="num">{formatDateTime(c.previous_secret_valid_until, locale)}</span></Row>}
            </Rows>
            <Note>{d('security.note')}</Note>
            <Actions>{btn('rotate')}{btn('events')}{btn('revoke')}{btn('delete')}</Actions>
          </Section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Section({ id, title, open, onToggle, children }: { id: string; title: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="rounded border border-border">
      <h3 id={id} className="text-sm font-semibold text-text">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={`${id}-body`}
          className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2.5 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40"
        >
          <span className="min-w-0">{title}</span>
          <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted transition-transform', open && 'rotate-180 text-primary')} strokeWidth={2} aria-hidden="true" />
        </button>
      </h3>
      {open && (
        <div id={`${id}-body`} className="space-y-2.5 border-t border-border p-3">
          {children}
        </div>
      )}
    </section>
  );
}

function Rows({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-1 gap-x-6 gap-y-0.5 text-xs sm:grid-cols-[max-content_minmax(0,1fr)] sm:gap-y-1.5">{children}</dl>;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="mt-1.5 text-muted first:mt-0 sm:mt-0">{label}</dt>
      <dd className="min-w-0 text-text [overflow-wrap:anywhere]">{children}</dd>
    </>
  );
}

function Note({ children, tone }: { children: ReactNode; tone?: 'warning' }) {
  return (
    <p role="note" className={tone === 'warning' ? 'rounded bg-warning/10 px-3 py-2 text-xs leading-relaxed text-warning' : 'text-xs leading-relaxed text-muted'}>
      {children}
    </p>
  );
}

function Actions({ children }: { children: ReactNode }) {
  const items = Array.isArray(children) ? children.filter(Boolean) : children ? [children] : [];
  if (items.length === 0) return null;
  return <div className="flex flex-wrap gap-1 pt-1">{children}</div>;
}
