import { api } from '@/lib/api';
import { assertId } from '../client';
import { overrideFields, readAccounts, readEvaluation, readValues, type Evaluation, type LedgerAccount, type PostingField, type PostingValues } from './logic';

/**
 * TANKER-PR6B-1 — نقطة الشبكة الوحيدة لبطاقة إعدادات الدمج المخزني: ثلاث قراءات (إعدادات المؤسسة/المحطة، تقييم الإعداد، دليل الحسابات) وكتابة واحدة (PUT الإعدادات القائمة).
 * **لا ترحيل ولا خصم ولا قيد**؛ لا `tenant_id` في أي حمولة. الخادم يفرض الحوكمة والتحقق والنطاق والتدقيق.
 */
const SETTINGS = '/fuel-stations/settings';
const STATIONS = '/fuel-stations/stations';
const EVALUATION = '/fuel-stations/tanker-fills/inventory-settings';
const ACCOUNTS = '/accounts';

const settingsPath = (stationId?: string): string => (stationId ? `${STATIONS}/${assertId(stationId)}/settings?branch=all` : SETTINGS);

export interface PostingState {
  values: PostingValues;
  /** `null` لنطاق المؤسسة. */
  overrides: Set<PostingField> | null;
}

function toState(payload: unknown, stationScope: boolean): PostingState {
  const body = (typeof payload === 'object' && payload !== null ? payload : {}) as { data?: unknown; meta?: { overrides?: unknown } };
  return { values: readValues(body.data), overrides: stationScope ? overrideFields(body.meta?.overrides) : null };
}

export async function getPostingSettings(stationId?: string): Promise<PostingState> {
  return toState(await api<unknown>(settingsPath(stationId)), Boolean(stationId));
}

export async function getEvaluation(stationId?: string): Promise<Evaluation> {
  return readEvaluation(await api<unknown>(stationId ? `${EVALUATION}?station_id=${assertId(stationId)}` : EVALUATION));
}

export async function listLedgerAccounts(): Promise<LedgerAccount[]> {
  return readAccounts(await api<unknown>(ACCOUNTS));
}

export async function savePostingSettings(stationId: string | undefined, changes: Record<string, boolean | string | null>, reason?: string): Promise<PostingState> {
  const body = reason && reason.trim() !== '' ? { ...changes, reason: reason.trim() } : changes;
  return toState(await api<unknown>(settingsPath(stationId), { method: 'PUT', body }), Boolean(stationId));
}
