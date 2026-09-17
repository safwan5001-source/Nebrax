'use client';

import { useState } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { commerceWorkspaceMessage } from '@/modules/commerce-workspace/messages';
import { addCommerceCustomDomain, type CommerceStoreDomain } from '@/modules/commerce-workspace/domains';

/**
 * STORE-ADMIN-ADOPT-1B-3A — حوار «إضافة نطاق مخصَّص»: حقل `hostname` فقط —
 * لا مُحدِّد Tenant، لا مُحدِّد نوع، لا مربّع حالة تحقّق، لا خانة أساسي/نشط
 * (القرار §35). النجاح يعيد التمثيل الموثوق الكامل من الخادم (بما فيه
 * تعليمات DNS) — لا تفاؤل محلي، ولا بناء token في المتصفح.
 */
export function AddCustomDomainDialog({
  open,
  onClose,
  onAdded,
  storefrontId,
  locale,
}: {
  open: boolean;
  onClose: () => void;
  onAdded: (domain: CommerceStoreDomain) => void;
  storefrontId: string;
  locale: string | undefined;
}) {
  const t = (key: Parameters<typeof commerceWorkspaceMessage>[1]) => commerceWorkspaceMessage(locale, key);
  const [hostname, setHostname] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return; // يمنع إرسالاً مزدوجاً عرضياً أثناء الانتظار
    setError(null);

    const trimmed = hostname.trim();
    if (trimmed === '') {
      setError(t('addDomainHostnameRequired'));
      return;
    }

    setSubmitting(true);
    try {
      const result = await addCommerceCustomDomain(storefrontId, trimmed);
      if (!result.ok) {
        setError(errorMessage(result.reason, t));
        return;
      }
      onAdded(result.domain);
      setHostname('');
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={t('addDomainTitle')}>
      <form onSubmit={submit} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="add-domain-hostname">{t('addDomainHostnameLabel')}</Label>
          <Input
            id="add-domain-hostname"
            dir="ltr"
            placeholder={t('addDomainHostnamePlaceholder')}
            value={hostname}
            onChange={(e) => setHostname(e.target.value)}
          />
        </div>

        {error ? <p className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p> : null}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            {t('storeSettingsCancel')}
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? t('addDomainSubmitting') : t('addDomainSubmit')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function errorMessage(
  reason: 'invalid_hostname' | 'managed_namespace' | 'conflict' | 'forbidden' | 'not_found' | 'failed',
  t: (key: Parameters<typeof commerceWorkspaceMessage>[1]) => string,
): string {
  switch (reason) {
    case 'invalid_hostname':
      return t('addDomainInvalidHostname');
    case 'managed_namespace':
      return t('addDomainManagedNamespace');
    case 'conflict':
      return t('addDomainConflict');
    case 'forbidden':
      return t('addDomainForbidden');
    default:
      return t('addDomainFailed');
  }
}
