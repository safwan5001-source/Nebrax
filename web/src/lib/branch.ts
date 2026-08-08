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
const EVENT = 'nibras:branch-changed';

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
 * الفروع + الفرع النشط. النشط = المخزَّن محلياً إن كان صالحاً، وإلا **الفرع
 * الرئيسي** من الإعدادات (الافتراضي المتّفق عليه)، وإلا أول فرع.
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

  const stored = activeId && branches.some((b) => b.id === activeId) ? activeId : null;
  const resolvedId = stored ?? mainBranchId ?? branches[0]?.id ?? null;
  const active = branches.find((b) => b.id === resolvedId) ?? null;

  return { branches, active, activeId: resolvedId, mainBranchId, loading, setActiveBranchId };
}
