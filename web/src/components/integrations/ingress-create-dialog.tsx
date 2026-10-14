'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Select } from '@/components/ui/select';
import { PlainTextField } from '@/components/shared/plain-text-field';
import { checkStoreId } from '@/lib/ingress-create';
import type { IngressErrorKey } from '@/lib/ingress-management';
import type { CreateIngressRequest } from './use-ingress-management';
import { useBranchOptions } from './use-signed-ingress';

/**
 * نموذج إنشاء نقطة استقبال موقّعة (INT-UX-5c). الحقول **هي حقول عقد الخادم فقط**: معرّف المتجر (إلزامي)، والفرع (اختياري من
 * خيارات المستخدم). المنصة وملف الإسناد اليدوي ثابتان من الصفحة (لا اختيار ولا إنشاء ملف هنا).
 *
 * الفرع: `GET /branches` (الخادم يصفّيها بنطاق المستخدم) للراحة فقط؛ الحكم للخادم — مقيَّد بفروع بلا فرع يُرفض بـ
 * `branch_required` ويبقى النموذج مفتوحاً للتصحيح. بلا `branches.view` لا حقل فرع وتُذكر العلّة. أثناء الإرسال لا يُغلق
 * النموذج ولا تُعدَّل حقوله، ولا إعادة محاولة تلقائية.
 */
export function IngressCreateDialog({
  platformName,
  busy,
  error,
  isBlocked,
  onCancel,
  onSubmit,
}: {
  platformName: string;
  busy: boolean;
  error: IngressErrorKey | null;
  /** معرّف نتيجة إنشائه السابق لم تتأكد؟ يُمنع إرساله (يُتحقق منه في الإدارة أيضاً). */
  isBlocked: (storeId: string) => boolean;
  onCancel: () => void;
  onSubmit: (request: CreateIngressRequest) => void;
}) {
  const t = useTranslations('integrationCenter.ingressManagement');
  const [storeId, setStoreId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [touched, setTouched] = useState(false);
  const [branchAttempt, setBranchAttempt] = useState(0);
  const branches = useBranchOptions(true, branchAttempt);

  const checked = checkStoreId(storeId);
  const blocked = checked.ok && isBlocked(checked.value);
  const storeError = blocked ? t('errors.createBlocked') : touched && !checked.ok ? t(`create.validation.${checked.problem}`) : null;
  const branchBlocked = branches.status === 'loading' || branches.status === 'error';

  function submit() {
    setTouched(true);
    if (!checked.ok || blocked || branchBlocked || busy) return;
    onSubmit({ storeId, branchId: branchId === '' ? null : branchId });
  }

  return (
    <Dialog open onClose={busy ? () => {} : onCancel} title={t('create.title')} className="max-w-md" hideClose={busy}>
      {/* لا عنصر form: الإرسال بزرّ صريح أو Enter داخل حقل النص (الحارس البنيوي يمنع عناصر النماذج الخام في هذه الوحدة). */}
      <div
        className="space-y-4"
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.target as HTMLElement).tagName === 'INPUT') {
            event.preventDefault();
            submit();
          }
        }}
      >
        <p className="text-sm leading-relaxed text-muted">{t('create.intro', { platform: platformName })}</p>

        <PlainTextField
          value={storeId}
          onChange={setStoreId}
          label={t('create.storeId.label')}
          hint={t('create.storeId.hint')}
          error={storeError}
          disabled={busy}
          required
          testId="ingress-create-store-id"
        />

        {branches.status === 'idle' ? (
          <p className="text-xs leading-relaxed text-muted" data-testid="ingress-create-branch-unavailable">{t('create.branch.noPermission')}</p>
        ) : branches.status === 'loading' ? (
          <p role="status" className="text-xs text-muted" data-testid="ingress-create-branch-loading">{t('create.branch.loading')}</p>
        ) : branches.status === 'error' ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded border border-border px-3 py-2 text-xs text-negative" data-testid="ingress-create-branch-error">
            <span>{t('create.branch.error')}</span>
            <Button type="button" variant="outline" size="sm" onClick={() => setBranchAttempt((value) => value + 1)}>{t('create.branch.retry')}</Button>
          </div>
        ) : (
          <div className="space-y-1.5">
            <label htmlFor="ingress-create-branch" className="block text-sm font-medium text-text">{t('create.branch.label')}</label>
            <Select id="ingress-create-branch" value={branchId} onChange={(event) => setBranchId(event.target.value)} disabled={busy} data-testid="ingress-create-branch">
              <option value="">{t('create.branch.none')}</option>
              {branches.options.map((option) => (
                <option key={option.id} value={option.id}>{option.name}</option>
              ))}
            </Select>
            <p className="text-xs leading-relaxed text-muted">{t('create.branch.hint')}</p>
          </div>
        )}

        <p className="text-xs leading-relaxed text-muted" data-testid="ingress-create-boundary">{t('create.boundary')}</p>

        {error ? (
          <p role="alert" className="rounded border border-border px-3 py-2 text-sm text-negative" data-testid="ingress-create-error">{t(`errors.${error}`)}</p>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>{t('common.cancel')}</Button>
          <Button type="button" onClick={submit} disabled={busy || branchBlocked || blocked} data-testid="ingress-create-submit">{busy ? t('create.busy') : t('create.submit')}</Button>
        </div>
      </div>
    </Dialog>
  );
}
