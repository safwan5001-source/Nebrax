import { api } from '@/lib/api';

/**
 * H6 Batch E staff API for wholesale membership applications.
 *   GET  commerce/wholesale/channels/{channelId}/memberships?status&per_page&page
 *   POST commerce/wholesale/memberships/{id}/{approve|reject|suspend|reinstate}   body { note? }
 * Permission `commerce.wholesale.manage` (owner/admin). The server owns the state machine; the transition table below
 * only decides which buttons are offered. No tenant is ever sent: the session carries it.
 */

export const MEMBERSHIP_STATUSES = ['pending', 'approved', 'rejected', 'suspended'] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export const MEMBERSHIP_ACTIONS = ['approve', 'reject', 'suspend', 'reinstate'] as const;
export type MembershipAction = (typeof MEMBERSHIP_ACTIONS)[number];

/** Mirrors `WholesaleMembershipService::TRANSITIONS`. */
export const MEMBERSHIP_TRANSITIONS: Record<MembershipAction, { from: readonly MembershipStatus[]; to: MembershipStatus }> = {
  approve: { from: ['pending'], to: 'approved' },
  reject: { from: ['pending'], to: 'rejected' },
  suspend: { from: ['approved'], to: 'suspended' },
  reinstate: { from: ['suspended'], to: 'approved' },
};

export const DECISION_NOTE_MAX = 500;

export function actionsFor(status: string): MembershipAction[] {
  return MEMBERSHIP_ACTIONS.filter((action) => (MEMBERSHIP_TRANSITIONS[action].from as readonly string[]).includes(status));
}

export type Membership = {
  id: string;
  sales_channel_id: string;
  status: string;
  applied_at: string | null;
  decided_at: string | null;
  decided_by: { id: string; name: string } | null;
  decision_note: string | null;
  customer: { id: string | null; display_name: string | null; email: string | null; phone: string | null };
};

export type MembershipsMeta = { page: number; per_page: number; total: number; last_page: number };

export type MembershipQuery = { status?: MembershipStatus | ''; page?: number; perPage?: number };

export function membershipsPath(channelId: string): string {
  return `/commerce/wholesale/channels/${encodeURIComponent(channelId)}/memberships`;
}

export function buildMembershipsQuery(query: MembershipQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.status && (MEMBERSHIP_STATUSES as readonly string[]).includes(query.status)) params.set('status', query.status);
  if (query.page && query.page > 1) params.set('page', String(query.page));
  params.set('per_page', String(Math.min(Math.max(query.perPage ?? 25, 1), 100)));
  return params;
}

export async function fetchMemberships(channelId: string, query: MembershipQuery = {}): Promise<{ data: Membership[]; meta: MembershipsMeta }> {
  const response = await api<{ data: Membership[]; meta?: MembershipsMeta }>(`${membershipsPath(channelId)}?${buildMembershipsQuery(query).toString()}`);
  const data = Array.isArray(response.data) ? response.data : [];
  return { data, meta: response.meta ?? { page: 1, per_page: data.length || 1, total: data.length, last_page: 1 } };
}

/** Real server total for one status (per_page=1 → `meta.total`). */
export async function fetchMembershipCount(channelId: string, status: MembershipStatus): Promise<number> {
  const { meta } = await fetchMemberships(channelId, { status, perPage: 1 });
  return meta.total;
}

export async function fetchMembershipCounts(channelId: string): Promise<Record<MembershipStatus, number>> {
  const totals = await Promise.all(MEMBERSHIP_STATUSES.map((status) => fetchMembershipCount(channelId, status)));
  return Object.fromEntries(MEMBERSHIP_STATUSES.map((status, index) => [status, totals[index]])) as Record<MembershipStatus, number>;
}

export async function transitionMembership(id: string, action: MembershipAction, note?: string): Promise<Membership> {
  const trimmed = note?.trim();
  const body = trimmed ? { note: trimmed.slice(0, DECISION_NOTE_MAX) } : {};
  const response = await api<{ data: Membership }>(`/commerce/wholesale/memberships/${encodeURIComponent(id)}/${action}`, { method: 'POST', body });
  return response.data;
}
