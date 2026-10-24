'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, hasApiStatus } from '@/lib/api';
import { apiErrorCode } from '@/modules/payments/gateways/contract';
import { BRANCH_SCOPE_FORBIDDEN } from './contract';

export type ReportError = 'branch_scope_forbidden' | 'forbidden' | 'failed';

/** يحمّل تقريراً مقروءاً من `/payment-reports/*` ويتجاهل الردود القديمة؛ رموز الخطأ تُترجَم في الواجهة. */
export function useReport<T>(path: string): { data: T | null; loading: boolean; error: ReportError | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ReportError | null>(null);
  const latest = useRef(0);

  const load = useCallback(async () => {
    const mine = ++latest.current;
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ data: T }>(path);
      if (mine !== latest.current) return;
      setData(res.data);
      setLoading(false);
    } catch (e) {
      if (mine !== latest.current) return;
      setData(null);
      setError(apiErrorCode(e) === BRANCH_SCOPE_FORBIDDEN ? 'branch_scope_forbidden' : hasApiStatus(e, 403) ? 'forbidden' : 'failed');
      setLoading(false);
    }
  }, [path]);

  useEffect(() => { void load(); }, [load]);

  return { data, loading, error, reload: () => void load() };
}
