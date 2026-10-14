'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { useCan } from '@/lib/use-can';
import type { ScopeCaps, ScopeForm, ScopeIssues } from '@/modules/users/editor';
import { ScopePicker, type PickerOption } from './scope-picker';

interface BranchOption {
  id: string;
  name: string;
  code?: string;
}
interface WarehouseOption extends BranchOption {
  branch_id?: string | null;
}

/**
 * هل يستطيع المشاهد تحميل قائمتَي الفروع والمستودعات؟ (D-J) — كلٌّ خلف صلاحيتها المستقلة
 * (`branches.view` / `products.view`). بلا الصلاحية لا نطلب القائمة (طلبٌ يُعرف سلفاً أنه 403) ولا نعدّل
 * ذلك البُعد: يُعرض للقراءة فقط ولا يُرسَل مفتاحه.
 */
export function useScopeCaps(): ScopeCaps {
  const { can } = useCan();
  const branches = can('branches.view');
  const warehouses = can('products.view');
  return useMemo(() => ({ branches, warehouses }), [branches, warehouses]);
}

/** قوائم الفروع والمستودعات (مستودعٌ مع فرعه الأم سياقاً)، تُحمَّل عند `enabled` ولمن يملك صلاحيتها فقط. */
export function useScopeLookups(enabled: boolean, caps: ScopeCaps) {
  const [branches, setBranches] = useState<BranchOption[] | null>(null);
  const [warehouses, setWarehouses] = useState<WarehouseOption[] | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (caps.branches) api<{ data: BranchOption[] }>('/branches').then((r) => setBranches(r.data)).catch(() => setBranches([]));
    if (caps.warehouses) api<{ data: WarehouseOption[] }>('/warehouses').then((r) => setWarehouses(r.data)).catch(() => setWarehouses([]));
  }, [enabled, caps.branches, caps.warehouses]);

  const branchName = useMemo(() => new Map((branches ?? []).map((b) => [b.id, b.name])), [branches]);
  const warehouseOptions: PickerOption[] | null = useMemo(
    () =>
      warehouses
        ? warehouses.map((w) => ({
            id: w.id,
            name: w.name,
            code: w.code,
            context: w.branch_id ? branchName.get(w.branch_id) : undefined,
          }))
        : null,
    [warehouses, branchName],
  );
  return { branches, warehouses: warehouseOptions };
}

/**
 * محرّر نطاق الوصول المشترك (فروع + مستودعات): المرجع الوحيد لهذا المعنى في الواجهة — يستعمله محرّر المستخدم
 * ونموذج الموظف. الحالة (`value`) والتحقق (`issues`) يملكهما المستدعي؛ هنا العرض والقوائم فقط.
 */
export function AccessScopeEditor({
  value,
  onChange,
  caps,
  restricted,
  issues,
  branchOptions,
  warehouseOptions,
}: {
  value: ScopeForm;
  onChange: (next: ScopeForm) => void;
  caps: ScopeCaps;
  /** البُعد مقيَّد عند الفاعل نفسه: لا «الكل»، والقوائم مقصورة على نطاقه (ويُقال ذلك). */
  restricted: ScopeCaps;
  issues: ScopeIssues;
  branchOptions: PickerOption[] | null;
  warehouseOptions: PickerOption[] | null;
}) {
  const t = useTranslations('users');
  return (
    <>
      <div className="space-y-1.5">
        <Label>{t('scope_branches')}</Label>
        <ScopePicker
          kind="branches"
          draft={value.branches}
          onChange={(branches) => onChange({ ...value, branches })}
          options={branchOptions}
          editable={caps.branches}
          actorRestricted={restricted.branches}
          issue={issues.branches}
        />
      </div>
      <div className="space-y-1.5">
        <Label>{t('scope_warehouses')}</Label>
        <ScopePicker
          kind="warehouses"
          draft={value.warehouses}
          onChange={(warehouses) => onChange({ ...value, warehouses })}
          options={warehouseOptions}
          editable={caps.warehouses}
          actorRestricted={restricted.warehouses}
          issue={issues.warehouses}
        />
      </div>
    </>
  );
}
