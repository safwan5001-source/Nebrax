'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export interface Option { id: string; label: string }

/** قوائم خيارات المرشحات من واجهات الوقود القائمة (المحطات/المنتجات/المضخات/الفوهات/الورديات). الخادم يقيّد كلاً بنطاق المستخدم. */
export function useOptions(path: string | null, labelOf: (row: Record<string, unknown>) => string): { options: Option[]; loading: boolean } {
  const [options, setOptions] = useState<Option[]>([]);
  const [loading, setLoading] = useState(path !== null);
  useEffect(() => {
    if (path === null) { setOptions([]); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    api<{ data?: Array<Record<string, unknown>> }>(path)
      .then((res) => { if (!cancelled) setOptions((res.data ?? []).filter((row) => typeof row.id === 'string').map((row) => ({ id: String(row.id), label: labelOf(row) }))); })
      .catch(() => { if (!cancelled) setOptions([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // labelOf ثابتة لكل استدعاء
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);
  return { options, loading };
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
export const stationLabel = (r: Record<string, unknown>) => str(r.name) || str(r.code);
export const productLabel = (r: Record<string, unknown>) => str(r.name) || str(r.code);
export const pumpLabel = (r: Record<string, unknown>) => str(r.name) || `#${str(r.pump_number)}`;
export const nozzleLabel = (r: Record<string, unknown>) => `#${str(r.nozzle_number)}`;
export const shiftLabel = (r: Record<string, unknown>) => `${str(r.number)} · ${str(r.opened_at).slice(0, 16).replace('T', ' ')}`;
