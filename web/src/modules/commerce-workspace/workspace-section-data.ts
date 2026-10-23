/**
 * FLOWERS-H9c / ADR-21 — authenticated, read-only section data for the
 * Experience Builder. The API returns the same public-safe product/facet
 * projections used by the storefront; this adapter only validates shape and
 * never computes prices, availability, publication, or delivery decisions.
 */
import { api, hasApiStatus } from '@/lib/api';
import {
  mapWorkspaceProductSummary,
  type WorkspaceProductSummary,
} from './workspace-products';
import { COMMERCE_STORE_ADMIN_LIST_PATH } from './stores';

export function commerceWorkspaceSectionDataPath(storefrontId: string): string {
  return `${COMMERCE_STORE_ADMIN_LIST_PATH}/${encodeURIComponent(storefrontId)}/section-data`;
}

export interface WorkspaceDiscoveryOption {
  value: string;
  name: string;
  nameEn: string | null;
  count: number;
  visual: Record<string, unknown> | null;
}

export interface WorkspaceDiscoveryData {
  axis: 'brand' | 'facet';
  dimension?: string;
  name: string;
  nameEn: string | null;
  visual: Record<string, unknown> | null;
  options: WorkspaceDiscoveryOption[];
}

export interface WorkspaceDeliveryEarliest {
  date: string;
  startTime: string;
  endTime: string;
  label: string;
  labelEn: string | null;
  timezone: string;
}

export type WorkspaceSectionDataOutcome =
  | { ok: true; section: 'product_shelf'; products: WorkspaceProductSummary[] }
  | { ok: true; section: 'discovery'; discovery: WorkspaceDiscoveryData | null }
  | { ok: true; section: 'delivery_promise'; earliest: WorkspaceDeliveryEarliest | null }
  | { ok: false; reason: 'forbidden' | 'not_found' | 'failed'; message: string };

function failure(error: unknown): Extract<WorkspaceSectionDataOutcome, { ok: false }> {
  const reason = hasApiStatus(error, 403)
    ? 'forbidden'
    : hasApiStatus(error, 404)
      ? 'not_found'
      : 'failed';
  return { ok: false, reason, message: error instanceof Error && error.message ? error.message : 'section_data_failed' };
}

function invalidSectionData(): Extract<WorkspaceSectionDataOutcome, { ok: false }> {
  return { ok: false, reason: 'failed', message: 'section_data_invalid' };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function discoveryPayload(value: unknown): WorkspaceDiscoveryData | null {
  const row = record(value);
  if (!row || (row.axis !== 'brand' && row.axis !== 'facet') || typeof row.name !== 'string' || !Array.isArray(row.options)) return null;
  const options = row.options.map((item) => {
    const option = record(item);
    if (!option || typeof option.value !== 'string' || typeof option.name !== 'string' || typeof option.count !== 'number') return null;
    return {
      value: option.value,
      name: option.name,
      nameEn: typeof option.name_en === 'string' ? option.name_en : null,
      count: option.count,
      visual: record(option.visual),
    };
  });
  if (options.some((option) => option === null)) return null;
  return {
    axis: row.axis,
    dimension: typeof row.dimension === 'string' ? row.dimension : undefined,
    name: row.name,
    nameEn: typeof row.name_en === 'string' ? row.name_en : null,
    visual: record(row.visual),
    options: options.filter((option): option is NonNullable<typeof option> => option !== null),
  };
}

export async function fetchWorkspaceSectionData(
  storefrontId: string,
  params: Record<string, string | number | boolean | undefined>,
  signal?: AbortSignal,
): Promise<WorkspaceSectionDataOutcome> {
  try {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) query.set(key, String(value));
    }
    const suffix = query.toString();
    const payload = await api<unknown>(`${commerceWorkspaceSectionDataPath(storefrontId)}${suffix ? `?${suffix}` : ''}`, { signal });
    const body = record(payload);
    const section = params.section;
    const data = body ? body.data : undefined;
    if (section === 'product_shelf') {
      if (!Array.isArray(data)) return invalidSectionData();
      const rows = data.map((item) => mapWorkspaceProductSummary(item));
      if (rows.some((row) => row === null)) return invalidSectionData();
      return { ok: true, section: 'product_shelf', products: rows.filter((row): row is WorkspaceProductSummary => row !== null) };
    }
    if (section === 'discovery') {
      if (data === null) return { ok: true, section: 'discovery', discovery: null };
      const discovery = discoveryPayload(data);
      return discovery ? { ok: true, section: 'discovery', discovery } : invalidSectionData();
    }
    const row = record(data);
    if (!row || !Object.prototype.hasOwnProperty.call(row, 'earliest')) return invalidSectionData();
    const earliest = record(row?.earliest);
    if (row.earliest !== null && (!earliest || typeof earliest.date !== 'string' || typeof earliest.start_time !== 'string' || typeof earliest.end_time !== 'string' || typeof earliest.label !== 'string' || typeof earliest.timezone !== 'string')) return invalidSectionData();
    return {
      ok: true,
      section: 'delivery_promise',
      earliest: earliest && typeof earliest.date === 'string' && typeof earliest.start_time === 'string' && typeof earliest.end_time === 'string' && typeof earliest.label === 'string' && typeof earliest.timezone === 'string'
        ? {
            date: earliest.date,
            startTime: earliest.start_time,
            endTime: earliest.end_time,
            label: earliest.label,
            labelEn: typeof earliest.label_en === 'string' ? earliest.label_en : null,
            timezone: earliest.timezone,
          }
        : null,
    };
  } catch (error) {
    return failure(error);
  }
}
