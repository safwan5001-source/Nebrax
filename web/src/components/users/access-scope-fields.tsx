'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { currentUser } from '@/lib/auth';
import { displayLocale } from '@/lib/formatting';
import { hasPermission } from '@/lib/permissions';

interface Option {
  id: string;
  name: string;
  code?: string;
}

export interface AccessScope {
  branch_ids: string[];
  warehouse_ids: string[];
}

export interface ScopeAvailability {
  branches: boolean;
  warehouses: boolean;
}

/**
 * هل يستطيع المشاهد تحميل قائمتَي الفروع والمستودعات؟ (D-J) — كلٌّ خلف صلاحيتها
 * المستقلة (`branches.view` / `products.view`). بلا الصلاحية لا نطلب القائمة (طلبٌ
 * يُعرف سلفاً أنه 403) ولا نعدّل ذلك البُعد: الحقل يُعرض للقراءة فقط ولا يُرسَل مفتاحه.
 */
export function useScopeAvailability(): ScopeAvailability {
  const me = currentUser();
  return {
    branches: hasPermission(me?.permissions, me?.role, 'branches.view'),
    warehouses: hasPermission(me?.permissions, me?.role, 'products.view'),
  };
}

/**
 * حقلا نطاق وصول المستخدم: فروعه ومستودعاته.
 *
 * **الفراغ يعني الكلّ** — وهو ما يقوله النصّ تحت كل حقل صراحةً، لأن المربّعات
 * الفارغة تُقرأ حدساً على أنها «لا شيء». والخادم يفسّرها كذلك (`allowedBranchIds`
 * تُعيد `null` لا `[]`)، فالنصّ يصف السلوك لا يُجمّله.
 */
export function AccessScopeFields({
  value,
  onChange,
  availability,
}: {
  value: AccessScope;
  onChange: (next: AccessScope) => void;
  /** غيابها = كلا البُعدين متاح (السلوك السابق لمن يستدعي بلا وعي بالصلاحيات). */
  availability?: ScopeAvailability;
}) {
  const t = useTranslations('users');
  const locale = useLocale();
  const [branches, setBranches] = useState<Option[] | null>(null);
  const [warehouses, setWarehouses] = useState<Option[] | null>(null);
  const canBranches = availability?.branches ?? true;
  const canWarehouses = availability?.warehouses ?? true;

  useEffect(() => {
    if (canBranches) api<{ data: Option[] }>('/branches').then((r) => setBranches(r.data)).catch(() => setBranches([]));
    if (canWarehouses) api<{ data: Option[] }>('/warehouses').then((r) => setWarehouses(r.data)).catch(() => setWarehouses([]));
  }, [canBranches, canWarehouses]);

  const toggle = (key: keyof AccessScope, id: string) => {
    const current = value[key];
    onChange({
      ...value,
      [key]: current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    });
  };

  const group = (
    key: keyof AccessScope,
    label: string,
    hint: string,
    options: Option[] | null,
    editable: boolean
  ) => (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {!editable ? (
        <p className="rounded border border-border px-3 py-2 text-sm text-muted">
          {value[key].length === 0 ? t(key === 'branch_ids' ? 'scope_all_branches' : 'scope_all_warehouses') : t('scope_read_only_count', { count: value[key].length.toLocaleString(displayLocale(locale)) })}
          {' — '}
          {t(key === 'branch_ids' ? 'scope_needs_branches_view' : 'scope_needs_warehouses_view')}
        </p>
      ) : options === null ? (
        <p className="text-xs text-muted">{t('scope_loading')}</p>
      ) : options.length === 0 ? (
        <p className="text-xs text-muted">{t('scope_none')}</p>
      ) : (
        <div className="max-h-36 space-y-1 overflow-y-auto rounded border border-border p-2">
          {options.map((o) => (
            <label key={o.id} className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="accent-primary"
                checked={value[key].includes(o.id)}
                onChange={() => toggle(key, o.id)}
              />
              <span>{o.name}</span>
              {o.code && <span className="num text-xs text-muted">{o.code}</span>}
            </label>
          ))}
        </div>
      )}
      <p className="text-xs leading-relaxed text-muted">{hint}</p>
    </div>
  );

  return (
    <>
      {group('branch_ids', t('scope_branches'), t('scope_branches_hint'), branches, canBranches)}
      {group('warehouse_ids', t('scope_warehouses'), t('scope_warehouses_hint'), warehouses, canWarehouses)}
    </>
  );
}
