/**
 * عميل REST لمساحة المطابقة والمراجعة (IMP-PS-A4b). كل نداء عبر `api()` (Bearer + الفرع النشط + 401). **المسارات المسموحة هنا فقط** — لا إغلاق/إبطال/استبدال
 * (PS-A4c) ولا اعتماد جماعي (PS-A4b0)؛ يحرس ذلك `workspace-architecture.test.ts` ساكناً.
 */
import { api } from '@/lib/api';
import type { PageMeta } from '../contract';
import type {
  DecisionRequest,
  DecisionResponse,
  LinesResponse,
  MatchOutcome,
  MatchesResponse,
  ReconciliationEvent,
  ReconciliationHeader,
  ReversedPairsResponse,
  RunSummary,
  StatusResponse,
  VerifySetResponse,
} from './types';

const base = (id: string) => `/partner-statement-reconciliations/${encodeURIComponent(id)}`;

export async function fetchHeader(id: string): Promise<ReconciliationHeader> {
  return (await api<{ data: ReconciliationHeader }>(base(id))).data;
}

export async function fetchStatus(id: string, runId?: string | null): Promise<StatusResponse> {
  const query = runId ? `?run_id=${encodeURIComponent(runId)}` : '';
  return (await api<{ data: StatusResponse }>(`${base(id)}/status${query}`)).data;
}

export async function fetchLines(id: string, page: number, perPage: number): Promise<LinesResponse> {
  const response = await api<Partial<LinesResponse>>(`${base(id)}/lines?page=${page}&per_page=${perPage}`);
  return { data: response.data ?? [], meta: response.meta ?? emptyMeta(perPage) };
}

export interface MatchesQuery {
  runId?: string | null;
  side: 'statement' | 'ledger';
  outcomes?: readonly MatchOutcome[];
  page: number;
  perPage: number;
}

export async function fetchMatches(id: string, query: MatchesQuery): Promise<MatchesResponse> {
  const params = new URLSearchParams({ side: query.side, page: String(query.page), per_page: String(query.perPage) });
  if (query.runId) params.set('run_id', query.runId);
  for (const outcome of query.outcomes ?? []) params.append('outcome[]', outcome);
  const response = await api<Partial<MatchesResponse>>(`${base(id)}/matches?${params.toString()}`);
  return {
    data: response.data ?? [],
    run: response.run ?? null,
    ledger_changed: response.ledger_changed ?? null,
    meta: response.meta ?? emptyMeta(query.perPage),
  };
}

/** `POST …/match`: صريح فقط (لا تشغيل تلقائي). 201 = تشغيلة جديدة، 200 = مُعادة (`replayed`). */
export async function runMatching(id: string): Promise<RunSummary> {
  return (await api<{ data: RunSummary }>(`${base(id)}/match`, { method: 'POST', body: {} })).data;
}

export async function verifySet(id: string, lineId: string, unitKeys: string[]): Promise<VerifySetResponse> {
  const params = new URLSearchParams({ line_id: lineId });
  for (const key of unitKeys) params.append('unit_keys[]', key);
  return (await api<{ data: VerifySetResponse }>(`${base(id)}/verify-set?${params.toString()}`)).data;
}

export async function postDecision(id: string, request: DecisionRequest): Promise<DecisionResponse> {
  const body = await api<Partial<DecisionResponse>>(`${base(id)}/decisions`, { method: 'POST', body: request });
  return { data: body.data ?? null, replayed: body.replayed === true, warnings: body.warnings ?? [] };
}

export async function fetchLineHistory(id: string, lineId: string): Promise<import('./types').Decision[]> {
  const response = await api<{ data?: import('./types').Decision[] }>(`${base(id)}/decisions?line_id=${encodeURIComponent(lineId)}&history=1&per_page=50`);
  return response.data ?? [];
}

export async function fetchReversedPairs(id: string): Promise<ReversedPairsResponse> {
  const response = await api<{ data?: Partial<ReversedPairsResponse> }>(`${base(id)}/reversed-pairs`);
  return { pairs: response.data?.pairs ?? [], truncated: response.data?.truncated === true };
}

/** `POST …/review`: 201 جديدة · 200 `replayed` (الجسم `{data: status, replayed}`). */
export async function markReviewed(id: string, runId: string, note: string | null): Promise<{ status: StatusResponse; replayed: boolean }> {
  const body: Record<string, unknown> = { run_id: runId };
  if (note) body.note = note;
  const response = await api<{ data: StatusResponse; replayed?: boolean }>(`${base(id)}/review`, { method: 'POST', body });
  return { status: response.data, replayed: response.replayed === true };
}

export async function reopenReconciliation(id: string, reason: string): Promise<void> {
  await api(`${base(id)}/reopen`, { method: 'POST', body: { reason } });
}

export async function fetchEvents(id: string, page: number): Promise<{ data: ReconciliationEvent[]; meta: PageMeta }> {
  const response = await api<{ data?: ReconciliationEvent[]; meta?: PageMeta }>(`${base(id)}/events?page=${page}&per_page=25`);
  return { data: response.data ?? [], meta: response.meta ?? emptyMeta(25) };
}

function emptyMeta(perPage: number): PageMeta {
  return { current_page: 1, last_page: 1, per_page: perPage, total: 0 };
}
