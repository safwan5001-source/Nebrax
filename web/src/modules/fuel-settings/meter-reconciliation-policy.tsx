'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { policyStatus, type MeterReconciliationMeta, type PolicyStatus } from './meter-reconciliation';

const STATUS_TONE: Record<PolicyStatus, string> = {
  active: 'border-positive bg-primary-soft text-text',
  pending_deployment: 'border-warning bg-surface text-text',
  unknown_deployment: 'border-warning bg-surface text-text',
  disabled: 'border-border bg-primary-soft text-text',
};

/**
 * سياسة «مطابقة قراءات العدّادات» داخل قسم الورديات (TANKER-PR8-S): مفتاح تفعيل واحد + شريط الحالة الفعلية + شرح ثابت لأثر الإغلاق والاعتماد.
 * **الإعداد يحكم إنشاء لقطات جديدة عند الإغلاق فقط**؛ متطلب المراجعة على الورديات المغلقة بلقطات مجمَّدة لا يتأثر بتعطيله. الخادم هو السلطة في الحوكمة والنطاق.
 */
export function MeterReconciliationPolicy({ checked, savedChecked, onChange, canEdit, canGovern, meta, onInherit }: {
  /** القيمة المعروضة في المفتاح (قد تكون مسودة غير محفوظة). */
  checked: boolean;
  /** القيمة المحفوظة فعلاً في الخادم لهذا النطاق — الحالة الفعلية تُشتق منها وحدها لا من المسودة. */
  savedChecked: boolean;
  onChange: (next: boolean) => void;
  /** يملك المستخدم إدارة الإعدادات للنطاق الحالي. */
  canEdit: boolean;
  /** يملك المستخدم صلاحية الحوكمة. */
  canGovern: boolean;
  meta: MeterReconciliationMeta | null;
  /** يظهر في نطاق المحطة فقط: العودة إلى القيمة الموروثة من المؤسسة. */
  onInherit?: () => void;
}) {
  const t = useTranslations('fuelStationsSettings.meterReconciliation');
  const status = policyStatus(savedChecked, meta);
  const dirty = checked !== savedChecked;
  const disabled = !canEdit || !canGovern;

  return (
    <section data-meter-reconciliation-policy className="mt-4 space-y-3 border-t border-border pt-4" aria-labelledby="meter-recon-title">
      <div>
        <h3 id="meter-recon-title" className="text-sm font-medium text-text">{t('title')}</h3>
        <p className="mt-1 text-xs leading-5 text-muted">{t('description')}</p>
      </div>

      <div className="flex min-h-14 items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
        <span className="text-sm text-text">{t('toggle')}</span>
        <span className="flex items-center gap-2">
          {onInherit && <Button type="button" size="sm" variant="ghost" className="min-h-11" disabled={disabled} onClick={onInherit}>{t('useInherited')}</Button>}
          <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} aria-label={t('toggle')} />
        </span>
      </div>

      {canEdit && !canGovern && <p role="note" data-meter-reconciliation-governance className="text-xs leading-5 text-warning">{t('governanceRequired')}</p>}

      {dirty && <p role="note" data-meter-reconciliation-unsaved className="text-xs leading-5 text-warning">{t('unsaved')}</p>}

      <p role="status" data-meter-reconciliation-status={status} className={`rounded-md border px-3 py-2 text-sm leading-6 ${STATUS_TONE[status]}`}>
        <span className="font-medium">{t(`status.${status}.title`)}</span>
        <span className="mt-0.5 block text-xs text-muted">{t(`status.${status}.body`)}</span>
        {meta?.source && <span data-meter-reconciliation-source={meta.source} className="mt-0.5 block text-xs text-muted">{t(`source.${meta.source}`)}</span>}
      </p>

      <ul className="space-y-1 text-xs leading-5 text-muted">
        <li>{t('notes.closeAllowed')}</li>
        <li>{t('notes.approvalNeedsReview')}</li>
        <li>{t('notes.frozenAtClose')}</li>
        <li>{t('notes.historical')}</li>
        <li>{t('notes.operationalOnly')}</li>
      </ul>
    </section>
  );
}
