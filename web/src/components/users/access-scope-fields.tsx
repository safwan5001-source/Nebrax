'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';

interface Option {
  id: string;
  name: string;
  code?: string;
}

export interface AccessScope {
  branch_ids: string[];
  warehouse_ids: string[];
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
}: {
  value: AccessScope;
  onChange: (next: AccessScope) => void;
}) {
  const t = useTranslations('users');
  const [branches, setBranches] = useState<Option[] | null>(null);
  const [warehouses, setWarehouses] = useState<Option[] | null>(null);

  useEffect(() => {
    api<{ data: Option[] }>('/branches').then((r) => setBranches(r.data)).catch(() => setBranches([]));
    api<{ data: Option[] }>('/warehouses').then((r) => setWarehouses(r.data)).catch(() => setWarehouses([]));
  }, []);

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
    options: Option[] | null
  ) => (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {options === null ? (
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
      {group('branch_ids', t('scope_branches'), t('scope_branches_hint'), branches)}
      {group('warehouse_ids', t('scope_warehouses'), t('scope_warehouses_hint'), warehouses)}
    </>
  );
}
