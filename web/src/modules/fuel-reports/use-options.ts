'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

type Page = { data?: Array<Record<string, unknown>>; meta?: { last_page?: number } };
/** سقف الصفحات المجلوبة لقوائم المرشحات (50 سطراً/صفحة في واجهات الوقود) — 10 صفحات = 500 صف الأحدث. */
export const MAX_OPTION_PAGES = 10;

/** يجلب كل صفحات قائمة مرقَّمة (الخادم الأحدث أولاً) حتى السقف، فلا تختفي السجلات الأقدم من المحدّدات. */
export async function loadAll(path: string, fetchPage: (url: string) => Promise<Page> = (url) => api<Page>(url)): Promise<Array<Record<string, unknown>>> {
  const first = await fetchPage(path);
  const rows = [...(first.data ?? [])];
  const last = Math.min(first.meta?.last_page ?? 1, MAX_OPTION_PAGES);
  for (let page = 2; page <= last; page += 1) {
    const next = await fetchPage(`${path}${path.includes('?') ? '&' : '?'}page=${page}`);
    rows.push(...(next.data ?? []));
  }
  return rows;
}

export interface Option { id: string; label: string }

/** قوائم خيارات المرشحات من واجهات الوقود القائمة (المحطات/المنتجات/المضخات/الفوهات/الورديات). الخادم يقيّد كلاً بنطاق المستخدم. */
export function useOptions(path: string | null, labelOf: (row: Record<string, unknown>) => string): { options: Option[]; loading: boolean } {
  const [options, setOptions] = useState<Option[]>([]);
  const [loading, setLoading] = useState(path !== null);
  useEffect(() => {
    if (path === null) { setOptions([]); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    loadAll(path)
      .then((rows) => { if (!cancelled) setOptions(rows.filter((row) => typeof row.id === 'string').map((row) => ({ id: String(row.id), label: labelOf(row) }))); })
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
