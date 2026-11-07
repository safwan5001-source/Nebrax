'use client';

import { useStationOps } from '../context';
import { StationOpsError } from '../read-client';
import type { Station } from '../schemas';
import { useScopedQuery, type QueryState, type ScopedQuery } from '../use-scoped-query';
import { openingAccess, type OpeningAccess } from './access';
import { getOpeningDoc, getOpeningPreview, getStationOpeningAccount, getTenantOpeningAccount, isValidDocId, listLedgerAccounts, listOpeningDocs } from './opening-client';
import type { OpeningAccount, OpeningDoc, OpeningPreview } from './schemas';

/** خطّافات القراءة. المفتاح يحمل (مستأجر|مستخدم|فرع) ثم المحطة فلا تسرّب ولا سباق (`useScopedQuery`). بلا صلاحية العرض لا يُرسَل أي طلب. */

const FORBIDDEN: QueryState<never> = { status: 'error', error: new StationOpsError('forbidden', 403) };

export function useOpeningAccess(): OpeningAccess {
  const { can } = useStationOps();
  return openingAccess(can);
}

/** مستندات المحطة (مسودات ومرحَّلة). 404 = بوابة النشر مغلقة ⇒ الميزة غير متاحة (لا تُعرض). */
export function useOpeningDocs(station: Station): ScopedQuery<OpeningDoc[]> {
  const { scopeKey } = useStationOps();
  const access = useOpeningAccess();
  const query = useScopedQuery<OpeningDoc[]>(access.view ? `${scopeKey}|${station.id}|opening|docs` : null, (signal) => listOpeningDocs(station.id, { signal, branchId: station.branch_id }));
  return { state: access.view ? query.state : FORBIDDEN, reload: query.reload };
}

export function useOpeningDoc(station: Station, id: string | null): ScopedQuery<OpeningDoc> {
  const { scopeKey } = useStationOps();
  const key = id && isValidDocId(id) ? `${scopeKey}|${station.id}|opening|doc|${id}` : null;
  return useScopedQuery<OpeningDoc>(key, (signal) => getOpeningDoc(id as string, { signal, branchId: station.branch_id }));
}

export function useOpeningAccounts(): ScopedQuery<OpeningAccount[]> & { allowed: boolean } {
  const { scopeKey } = useStationOps();
  const access = useOpeningAccess();
  const query = useScopedQuery<OpeningAccount[]>(access.accounts ? `${scopeKey}|opening|accounts` : null, (signal) => listLedgerAccounts({ signal }));
  return { allowed: access.accounts, state: query.state, reload: query.reload };
}

export interface ConfiguredAccounts { station: string | null; tenant: string | null }

/** الحساب المعيَّن فعلاً للمحطة (الفعّال) وافتراضي المؤسسة — لتمييز المصدر. فشل افتراضي المؤسسة لا يُسقط الأول (يُعامل «غير معروف» = null). */
export function useConfiguredAccounts(station: Station): ScopedQuery<ConfiguredAccounts> {
  const { scopeKey } = useStationOps();
  const access = useOpeningAccess();
  const query = useScopedQuery<ConfiguredAccounts>(access.view ? `${scopeKey}|${station.id}|opening|settings` : null, async (signal) => {
    const [stationAccount, tenantAccount] = await Promise.all([
      getStationOpeningAccount(station.id, { signal, branchId: station.branch_id }),
      getTenantOpeningAccount({ signal }).catch((error: unknown) => { if ((error as { name?: string })?.name === 'AbortError') throw error; return null; }),
    ]);
    return { station: stationAccount, tenant: tenantAccount };
  });
  return query;
}

export type PreviewFetch = (id: string) => Promise<OpeningPreview>;
export function previewFetcher(station: Station, signal?: AbortSignal): PreviewFetch {
  return (id) => getOpeningPreview(id, { signal, branchId: station.branch_id });
}
