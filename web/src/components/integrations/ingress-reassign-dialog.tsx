'use client';

import { useId, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import type { IngressManagement } from './use-ingress-management';

/**
 * حوار إعادة إسناد المشغّل (INT-UX-5d): قائمة **المشغّلين المؤهلين فقط** بالاسم (لا بريد ولا معرّف)، وملخّص التأكيد «من X إلى Y»، وزرّ
 * التأكيد لا يعمل إلا باختيار مرشّح صالح. أثناء الطلب لا يُغلق الحوار ولا يُعدَّل الاختيار. حالات الدليل (تحميل/فشل/فارغ) صريحة وآمنة:
 * الفشل ليس «لا مشغّلين». الحوار لا يغيّر فرعاً ولا حالة ولا سرّاً (يذكر ذلك). الخادم يبقى المرجع النهائي للأهلية.
 */
export function IngressReassignDialog({ management }: { management: IngressManagement }) {
  const t = useTranslations('integrationCenter.ingressManagement.reassign');
  const tErrors = useTranslations('integrationCenter.ingressManagement.errors');
  const tCommon = useTranslations('integrationCenter.ingressManagement.common');
  const locale = useLocale();
  const selectId = useId();
  const [selected, setSelected] = useState('');
  const point = management.reassignPoint;
  if (point === null) return null;

  const candidates = management.eligibleFor(point);
  const ambiguous = management.ambiguousFor(point);
  const valid = candidates.some((candidate) => candidate.id === selected);
  const fromName = management.currentOperatorName(point) ?? t('unknownOperator');
  const toName = valid ? candidates.find((candidate) => candidate.id === selected)?.name ?? '' : '';
  const { operators, busy } = management;

  return (
    <ConfirmDialog
      open
      onClose={management.cancelReassign}
      onConfirm={() => management.confirmReassign(selected)}
      title={t('title')}
      message={t('message')}
      detail={point.storeId}
      confirmLabel={t('confirm')}
      cancelLabel={tCommon('cancel')}
      busyLabel={t('busy')}
      danger={false}
      busy={busy}
      hideClose={busy}
      confirmDisabled={!valid}
    >
      <div className="space-y-3">
        <p className="text-sm text-muted" data-testid="reassign-current">{t('current', { operator: fromName })}</p>

        {operators.status === 'loading' ? (
          <p role="status" className="text-sm text-muted" data-testid="reassign-loading">{t('loading')}</p>
        ) : operators.status === 'error' || operators.status === 'idle' ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded border border-border px-3 py-2 text-sm text-negative" data-testid="reassign-directory-error">
            <span>{t('directoryError')}</span>
            <Button type="button" variant="outline" size="sm" onClick={management.retryOperators}>{t('retry')}</Button>
          </div>
        ) : candidates.length === 0 && ambiguous.length === 0 ? (
          <p role="note" className="rounded border border-dashed border-border px-3 py-2 text-sm leading-relaxed text-muted" data-testid="reassign-empty">{t('empty')}</p>
        ) : candidates.length === 0 ? null : (
          <div className="space-y-1.5">
            <label htmlFor={selectId} className="block text-sm font-medium text-text">{t('select.label')}</label>
            <Select id={selectId} value={selected} onChange={(event) => setSelected(event.target.value)} disabled={busy} data-testid="reassign-select">
              <option value="">{t('select.placeholder')}</option>
              {candidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
              ))}
            </Select>
            <p className="text-xs leading-relaxed text-muted">{t('select.hint')}</p>
          </div>
        )}

        {operators.status === 'ready' && ambiguous.length > 0 ? (
          <p role="note" className="rounded border border-border px-3 py-2 text-sm leading-relaxed text-text" data-testid="reassign-ambiguous">
            {t('ambiguous', { names: ambiguous.join(locale === 'ar' ? '، ' : ', ') })}
          </p>
        ) : null}

        {valid ? (
          <p className="rounded border border-border bg-background px-3 py-2 text-sm text-text" data-testid="reassign-summary">{t('summary', { from: fromName, to: toName })}</p>
        ) : null}

        {management.reassignError ? (
          <p role="alert" className="rounded border border-border px-3 py-2 text-sm text-negative" data-testid="reassign-error">{tErrors(management.reassignError)}</p>
        ) : null}
      </div>
    </ConfirmDialog>
  );
}
