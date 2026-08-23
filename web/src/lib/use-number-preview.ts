'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export type NumberingKey =
  | 'product'
  | 'invoice'
  | 'purchase'
  | 'quote'
  | 'return'
  | 'payment'
  | 'cash_bank_transfer'
  | 'credit_note'
  | 'procurement'
  | 'stock_permit'
  | 'stocktake'
  | 'expense'
  | 'asset'
  | 'pos_session'
  | 'fuel_shift'
  | 'fuel_sale'
  | 'fuel_maintenance_work_order'
  | 'fuel_safety_inspection'
  | 'corporate_fuel_contract'
  | 'journal_entry'
  | 'manual_journal'
  | 'payroll_run'
  | 'employee'
  | 'employee_custody'
  | 'employee_custody_settlement'
  | 'branch'
  | 'warehouse';

interface NumberPreviewResponse {
  data: { key: NumberingKey; series_key: string; number: string };
}

/**
 * يعيد الرقم المقترح لعرضه في النموذج فقط. لا يحجز الرقم؛ يبقى التخصيص
 * النهائي ذَرّياً في الخادم عند الحفظ حتى لا يسبب مستخدم متزامن تعارضاً.
 */
export function useNumberPreview(
  key: NumberingKey,
  options: { seriesKey?: string; date?: string; enabled?: boolean } = {},
): { number: string; loading: boolean } {
  const { seriesKey, date, enabled = true } = options;
  const [number, setNumber] = useState('');
  const [loading, setLoading] = useState(enabled);

  useEffect(() => {
    if (!enabled) {
      setNumber('');
      setLoading(false);
      return;
    }

    let active = true;
    const query = new URLSearchParams({ key });
    if (seriesKey) query.set('series_key', seriesKey);
    if (date) query.set('date', date);

    setLoading(true);
    api<NumberPreviewResponse>(`/number-preview?${query.toString()}`)
      .then((response) => {
        if (active) setNumber(response.data.number);
      })
      .catch(() => {
        if (active) setNumber('');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, [key, seriesKey, date, enabled]);

  return { number, loading };
}
