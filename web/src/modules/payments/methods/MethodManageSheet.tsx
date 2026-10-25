'use client';

import { useId, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { PaymentBrandMark } from '@/components/payments/payment-brand-mark';
import { paymentBrandPresentation } from '@/lib/payment-brand-registry';
import {
  changesOf,
  draftOf,
  isEnabledNotReady,
  methodTone,
  nextStep,
  type ManageDraft,
  type OnlineMethod,
} from '@/modules/payments/methods/contract';

/**
 * لوحة «إدارة» وسيلة دفع إلكتروني (PAY-SETTINGS-UX-2): الإعدادات المخزَّنة فعلاً فقط — البوابة الافتراضية وأماكن الاستخدام (فواتير/متجر).
 * لا خيار وهمي: POS لا تكامل له بعد فيُعلَن «غير متاح» بلا مفتاح. المفتاح الرئيسي «إظهار للعميل» يبقى في الصف. الحفظ بـPUT واحد بالحقول المتغيّرة فقط والخادم هو الحاسم.
 * لا اعتماد ولا مفاتيح هنا: تلك في «إدارة» البوابة نفسها.
 */
export function MethodManageSheet({
  method,
  canManage,
  saving,
  onClose,
  onSave,
  onOpenGateways,
}: {
  method: OnlineMethod | null;
  canManage: boolean;
  saving: boolean;
  onClose: () => void;
  onSave: (method: OnlineMethod, changes: Partial<ManageDraft>) => void;
  onOpenGateways: () => void;
}) {
  if (!method) return null;
  // مفتاح بحسب الوسيلة وحالتها المحفوظة: إعادة قراءة من الخادم تعيد تهيئة المسودة.
  return (
    <ManageBody
      key={`${method.key}:${method.default_gateway_id ?? ''}:${method.usage.invoices}:${method.usage.store}`}
      method={method}
      canManage={canManage}
      saving={saving}
      onClose={onClose}
      onSave={onSave}
      onOpenGateways={onOpenGateways}
    />
  );
}

function ManageBody({
  method,
  canManage,
  saving,
  onClose,
  onSave,
  onOpenGateways,
}: {
  method: OnlineMethod;
  canManage: boolean;
  saving: boolean;
  onClose: () => void;
  onSave: (method: OnlineMethod, changes: Partial<ManageDraft>) => void;
  onOpenGateways: () => void;
}) {
  const t = useTranslations('onlinePaymentMethods');
  const m = useTranslations('onlinePaymentMethods.manage');
  const uid = useId();
  const [draft, setDraft] = useState<ManageDraft>(() => draftOf(method));
  const brand = paymentBrandPresentation(method.key);
  const changes = changesOf(method, draft);
  const dirty = Object.keys(changes).length > 0;
  const step = nextStep(method);
  const notReady = isEnabledNotReady(method);
  const editable = canManage && !saving;

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent closeLabel={t('manage.close')} className="sm:max-w-lg" data-testid="pm-manage">
        <div className="space-y-2 border-b border-border p-4 pe-14">
          <SheetTitle className="flex min-w-0 flex-wrap items-center gap-2 text-base font-semibold">
            {brand ? <PaymentBrandMark brand={brand} withIcon /> : <span>{method.key}</span>}
            <Badge tone={methodTone(method.status)} data-testid="pm-manage-status">{t(`status.${method.status}`)}</Badge>
          </SheetTitle>
          <SheetDescription className="text-xs leading-relaxed text-muted">{m('description')}</SheetDescription>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto p-4">
          {/* 1 — الحالة والجاهزية */}
          <Section id={`${uid}-s1`} title={m('readiness.title')}>
            <p className="text-sm leading-relaxed text-text" data-testid="pm-reason">
              {notReady ? t('reasonEnabledNotReady') : method.enabled ? t('reasonEnabled') : t('reasonDisabled')}
            </p>
            {step && (
              <div className="flex flex-wrap items-center gap-2 rounded bg-warning/10 px-3 py-2 text-xs leading-relaxed text-warning">
                <span className="min-w-0 flex-1">{t(`step.${step}`)}</span>
                <Button size="sm" variant="outline" onClick={onOpenGateways}>{t('openGateways')}</Button>
              </div>
            )}
          </Section>

          {/* 2 — البوابة الافتراضية */}
          <Section id={`${uid}-s2`} title={m('gateway.title')}>
            {method.connections.length === 0 ? (
              <p className="text-xs leading-relaxed text-muted" data-testid="pm-no-connection">{m('gateway.none')}</p>
            ) : (
              <>
                <label htmlFor={`${uid}-gw`} className="block text-xs text-muted">{m('gateway.label')}</label>
                <Select
                  id={`${uid}-gw`}
                  value={draft.default_gateway_id ?? ''}
                  disabled={!editable}
                  onChange={(event) => setDraft((d) => ({ ...d, default_gateway_id: event.target.value === '' ? null : event.target.value }))}
                >
                  <option value="">{m('gateway.auto')}</option>
                  {method.connections.map((connection) => (
                    <option key={connection.gateway_id} value={connection.gateway_id}>
                      {connection.gateway_name} · {t(`environment.${connection.environment}`)} · {t(connection.eligible ? 'eligible' : connection.requires_provider_setup ? 'providerSetup' : 'notReady')}
                    </option>
                  ))}
                </Select>
                <p className="text-xs leading-relaxed text-muted">{draft.default_gateway_id ? m('gateway.fixedNote') : m('gateway.autoNote')}</p>
                <p className="text-xs text-muted" data-testid="pm-effective">
                  {m('gateway.effective')}:{' '}
                  <bdi dir="auto" className="text-text">{method.effective_gateway ? method.effective_gateway.name : t('noGateway')}</bdi>
                </p>
              </>
            )}
          </Section>

          {/* 3 — أماكن الاستخدام */}
          <Section id={`${uid}-s3`} title={m('usage.title')}>
            <ul className="divide-y divide-border rounded border border-border" data-testid="pm-usage">
              <UsageRow
                id={`${uid}-inv`}
                label={m('usage.invoices')}
                hint={m('usage.invoicesHint')}
                checked={draft.use_in_invoices}
                disabled={!editable}
                onChange={(next) => setDraft((d) => ({ ...d, use_in_invoices: next }))}
                testId="pm-use-invoices"
              />
              <UsageRow
                id={`${uid}-store`}
                label={m('usage.store')}
                hint={m('usage.storeHint')}
                checked={draft.use_in_store}
                disabled={!editable}
                onChange={(next) => setDraft((d) => ({ ...d, use_in_store: next }))}
                testId="pm-use-store"
              />
              <li className="flex items-start justify-between gap-3 p-3" data-testid="pm-use-pos">
                <div className="min-w-0">
                  <p className="text-sm text-text">{m('usage.pos')}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted">{m('usage.posUnavailable')}</p>
                </div>
                <Badge tone="muted">{m('usage.notSupported')}</Badge>
              </li>
            </ul>
          </Section>

          {/* 4 — الاتصالات */}
          {method.connections.length > 0 && (
            <Section id={`${uid}-s4`} title={t('connections')}>
              <ul className="flex flex-wrap gap-1.5">
                {method.connections.map((connection) => (
                  <li key={connection.gateway_id}>
                    <Badge tone={connection.eligible ? 'positive' : 'muted'}>
                      <bdi dir="auto">{connection.gateway_name}</bdi> · {t(connection.eligible ? 'eligible' : connection.requires_provider_setup ? 'providerSetup' : 'notReady')}
                    </Badge>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border p-3">
          {!canManage && <p className="me-auto text-xs text-muted" data-testid="pm-manage-readonly">{t('blocked.no_permission')}</p>}
          <Button variant="outline" onClick={onClose}>{m('cancel')}</Button>
          {canManage && (
            <Button disabled={!dirty || saving} onClick={() => onSave(method, changes)} data-testid="pm-manage-save">
              {saving ? m('saving') : m('save')}
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function UsageRow({
  id,
  label,
  hint,
  checked,
  disabled,
  onChange,
  testId,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
  testId: string;
}) {
  return (
    <li className="flex items-start justify-between gap-3 p-3" data-testid={testId}>
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm text-text">{label}</label>
        <p className="mt-0.5 text-xs leading-relaxed text-muted">{hint}</p>
      </div>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </li>
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
