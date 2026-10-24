'use client';

import { useId, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Check, Copy, History, KeyRound, Pause, Pencil, Play, ShieldCheck, ShieldOff, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
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
  const t = useTranslations('paymentGateways');
  const d = useTranslations('paymentGateways.detail');
  const locale = useLocale();
  const [copied, setCopied] = useState(false);
  const uid = useId();

  if (!connection) return null;
  const c = connection;
  const actions = availableActions(c, canManage);
  const blocked = activationBlock(c) !== null;
  const caps = c.provider_capabilities ?? null;
  const hasAdapter = caps !== null;
  const heading = (n: number) => `${uid}-h${n}`;

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
        </div>
        <div className="flex-1 space-y-6 overflow-y-auto p-4">
          {/* 1 — عام وحالة الاتصال */}
          <Section id={heading(1)} title={d('general.title')}>
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
          <Section id={heading(2)} title={d('keys.title')}>
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
          <Section id={heading(3)} title={d('methods.title')}>
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
          <Section id={heading(4)} title={d('webhooks.title')}>
            <Rows>
              <Row label={t('fields.webhookSecret')}>{c.has_webhook_secret ? t('fields.saved') : t('fields.missing')}</Row>
            </Rows>
            {webhookUrl ? (
              <div className="space-y-1.5">
                <p className="text-xs text-muted">{d('webhooks.url')}</p>
                <div className="flex items-start gap-2">
                  <bdi dir="ltr" className="min-w-0 flex-1 break-all rounded bg-primary-soft/40 px-2 py-1.5 text-xs text-text" data-testid="pg-webhook-url">{webhookUrl}</bdi>
                  <Button size="sm" variant="outline" onClick={() => void copyWebhook()} aria-label={d('webhooks.copy')}>
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
          <Section id={heading(5)} title={d('money.title')}>
            {hasAdapter ? (
              <Rows>
                <Row label={d('money.capture')}>{caps.hosted_checkout ? d('money.hosted') : d('money.notHosted')}</Row>
                <Row label={d('money.refunds')}>{caps.refunds ? d('money.refundsYes') : d('money.refundsNo')}</Row>
                <Row label={d('money.currencies')}><bdi dir="ltr">{caps.currencies.join(', ') || '—'}</bdi></Row>
                <Row label={d('money.minAmount')}><bdi dir="ltr">{formatRiyal(minorToRiyal(caps.min_amount_minor))}</bdi></Row>
                <Row label={t('fields.feeTaxPolicy')}>{c.fee_tax_policy === 'input_vat' ? t(c.fee_tax_opinion_recorded ? 'fields.feeTaxInputVat' : 'fields.feeTaxInputVatNoOpinion') : t('fields.feeTaxReject')}</Row>
              </Rows>
            ) : (
              <Note>{d('money.noAdapter')}</Note>
            )}
            <Note>{d('money.policyUnavailable')}</Note>
            <p className="text-xs">
              <Link href="/payments/online" className="text-primary underline-offset-2 hover:underline">{d('money.openOps')}</Link>
            </p>
          </Section>

          {/* 6 — الأمان وتدوير الأسرار وسجل التدقيق */}
          <Section id={heading(6)} title={d('security.title')}>
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

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-2.5 border-b border-border pb-5 last:border-b-0">
      <h3 id={id} className="text-sm font-semibold text-text">{title}</h3>
      {children}
    </section>
  );
}

function Rows({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5 text-xs">{children}</dl>;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 text-text">{children}</dd>
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
