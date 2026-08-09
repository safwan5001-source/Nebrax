'use client';

import { useEffect, useState } from 'react';
import { api } from './api';

/** فرع كما يعيده الـ API. */
export interface Branch {
  id: string;
  code: string;
  name: string;
  /** الفرع الرئيسي — عمود حقيقي، يتغيّر حصراً من «إعدادات الفروع». */
  is_main: boolean;
  phone?: string | null;
  mobile?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  description?: string | null;
  working_hours?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  is_active: boolean;
}

/** إعدادات الفروع (الفرع الرئيسي + مفاتيح المشاركة). */
export interface BranchSettings {
  main_branch_id: string | null;
  share_customers: boolean;
  share_products: boolean;
  share_suppliers: boolean;
  share_cost_centers: boolean;
  account_branch_scoping: boolean;
}

const ACTIVE_KEY = 'nibras_active_branch';

/**
 * حدث تغيّر الفرع النشط داخل التبويب الواحد. (بين التبويبات يكفي حدث `storage`.)
 * يستمع له مبدّل الفرع في الشريط العلوي **و**`BranchScope` الذي يُعيد جلب بيانات الصفحة.
 */
export const BRANCH_CHANGED_EVENT = 'nibras:branch-changed';
const EVENT = BRANCH_CHANGED_EVENT;

export function getActiveBranchId(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(ACTIVE_KEY);
}

/** يضبط الفرع النشط ويُعلم كل المستمعين في التبويب نفسه. */
export function setActiveBranchId(id: string | null): void {
  if (typeof window === 'undefined') return;
  if (id) localStorage.setItem(ACTIVE_KEY, id);
  else localStorage.removeItem(ACTIVE_KEY);
  window.dispatchEvent(new CustomEvent(EVENT));
}

/**
 * قاعدة حلّ الفرع النشط — دالة نقية لتكون قابلة للاختبار:
 * المخزَّن محلياً إن كان **فرعاً قائماً**، وإلا الفرع الرئيسي، وإلا أول فرع.
 *
 * حاسمة للتطابق بين ما تعرضه الواجهة وما تُرسله ترويسة `X-Branch-Id`:
 * معرّف مخزَّن لفرع محذوف يجب أن يسقط للرئيسي بدل أن يُرسَل كما هو.
 */
export function resolveActiveBranchId(
  branches: Pick<Branch, 'id'>[],
  storedId: string | null,
  mainBranchId: string | null,
): string | null {
  const valid = storedId && branches.some((b) => b.id === storedId) ? storedId : null;

  return valid ?? mainBranchId ?? branches[0]?.id ?? null;
}

/**
 * الفروع + الفرع النشط (انظر `resolveActiveBranchId`).
 * يتزامن عبر التبويب الواحد (حدث مخصّص) وبين التبويبات (storage).
 */
export function useBranches() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [mainBranchId, setMainBranchId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    api<{ data: Branch[]; main_branch_id: string | null }>('/branches')
      .then((r) => {
        if (!alive) return;
        setBranches(r.data);
        setMainBranchId(r.main_branch_id ?? null);
      })
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const sync = () => setActiveId(getActiveBranchId());
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const resolvedId = resolveActiveBranchId(branches, activeId, mainBranchId);
  const active = branches.find((b) => b.id === resolvedId) ?? null;

  // يثبّت الفرع المحلول في التخزين حين يكون المخزَّن غائباً أو لفرع محذوف —
  // فتتطابق ترويسة `X-Branch-Id` مع ما تعرضه الواجهة من أول لحظة. كتابة صامتة
  // بلا حدث عمداً: لولا ذلك لأعاد `BranchScope` جلب الصفحة عند كل تحميل.
  useEffect(() => {
    if (typeof window === 'undefined' || !resolvedId || activeId === resolvedId) return;
    localStorage.setItem(ACTIVE_KEY, resolvedId);
  }, [resolvedId, activeId]);

  return { branches, active, activeId: resolvedId, mainBranchId, loading, setActiveBranchId };
}
