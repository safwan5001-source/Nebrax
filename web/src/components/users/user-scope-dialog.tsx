'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { AccessScopeFields, type AccessScope } from './access-scope-fields';

/**
 * تعديل نطاق وصول مستخدم **قائم**.
 *
 * بدونه يبقى الإسناد ممكناً عند الإنشاء وحده — فلا يُقيَّد مستخدمٌ أُنشئ قبل
 * الميزة، ولا مالكُ الحساب نفسه. وهو ما يجعل الميزة نصفَ ميزة.
 *
 * يُرسل `branch_ids` و`warehouse_ids` وحدهما: التحديث في الخادم جزئيّ، فلا
 * تُمسّ بقية حقول المستخدم. والنطاق الحالي يصل مع القائمة، فلا نداء إضافي.
 */
export function UserScopeDialog({
  user,
  onClose,
  onSaved,
}: {
  user: { id: string; name: string; branch_ids?: string[]; warehouse_ids?: string[] };
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('users');
  const tc = useTranslations('common');
  const { success } = useToast();
  const [scope, setScope] = useState<AccessScope>({
    branch_ids: user.branch_ids ?? [],
    warehouse_ids: user.warehouse_ids ?? [],
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api(`/users/${user.id}`, { method: 'PUT', body: scope });
      success(tc('updated'));
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onClose={onClose} title={`${t('scope_title')} — ${user.name}`}>
      <form onSubmit={submit} className="space-y-3">
        <AccessScopeFields value={scope} onChange={setScope} />

        {error && <p className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button type="submit" disabled={saving}>
            {t('save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
