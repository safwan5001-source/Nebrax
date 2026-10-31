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
  /** Active partner link summary (list only); the drawer loads the full relationship. */
  partner_link?: { partner_id: string; partner_name: string; partner_code: string | null } | null;
  /** Unverified context the buyer typed when applying (company / phone) — for the reviewer, never an authority. */
  application?: { company_name: string | null; contact_phone: string | null };
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

// ───────────────────────── H6 Batch M: partner linking (staff) ─────────────────────────
//   GET    commerce/wholesale/partners/eligible?q&limit
//   GET    commerce/wholesale/memberships/{id}/partner-link
//   PUT    commerce/wholesale/memberships/{id}/partner-link   body { partner_id }
//   DELETE commerce/wholesale/memberships/{id}/partner-link
// Permissions: `commerce.wholesale.manage` AND `customer_access.manage`. Only a partner id is ever sent — never a tenant,
// a price list, or an actor; the server derives them and owns eligibility.

export const PARTNER_LINK_PERMISSIONS = ['commerce.wholesale.manage', 'customer_access.manage'] as const;

export type EligiblePartner = { id: string; code: string | null; name: string; name_en: string | null; phone: string | null; email: string | null; has_price_list: boolean };
export type PriceListRef = { id: string; name: string; is_active: boolean };
export type PartnerLinkRow = {
  id: string;
  status: 'active' | 'revoked' | string;
  link_method: string | null;
  partner: { id: string; code: string | null; name: string } | null;
  linked_at: string | null;
  linked_by: { id: string; name: string } | null;
  revoked_at: string | null;
  revoked_by: { id: string; name: string } | null;
};
export type EffectivePriceList = {
  source: 'partner' | 'channel' | 'none';
  price_list: PriceListRef | null;
  partner_list: PriceListRef | null;
  channel_list: PriceListRef | null;
};
export type PartnerLinkState = { active: PartnerLinkRow | null; history: PartnerLinkRow[]; effective_price_list: EffectivePriceList };

const partnerLinkPath = (membershipId: string) => `/commerce/wholesale/memberships/${encodeURIComponent(membershipId)}/partner-link`;

export function buildPartnerSearchQuery(q: string, limit = 20): string {
  const params = new URLSearchParams();
  const term = q.trim().slice(0, 100);
  if (term) params.set('q', term);
  params.set('limit', String(Math.min(Math.max(limit, 1), 50)));
  return params.toString();
}

export async function searchEligiblePartners(q: string): Promise<EligiblePartner[]> {
  const response = await api<{ data: EligiblePartner[] }>(`/commerce/wholesale/partners/eligible?${buildPartnerSearchQuery(q)}`);
  return Array.isArray(response.data) ? response.data : [];
}

function assertLinkState(state: PartnerLinkState | undefined): PartnerLinkState {
  if (!state || !state.effective_price_list || !Array.isArray(state.history)) throw new Error('Malformed partner-link response');
  return state;
}

export async function fetchPartnerLink(membershipId: string): Promise<PartnerLinkState> {
  return assertLinkState((await api<{ data: PartnerLinkState }>(partnerLinkPath(membershipId))).data);
}

export async function linkPartner(membershipId: string, partnerId: string): Promise<PartnerLinkState> {
  return assertLinkState((await api<{ data: PartnerLinkState }>(partnerLinkPath(membershipId), { method: 'PUT', body: { partner_id: partnerId } })).data);
}

export async function unlinkPartner(membershipId: string): Promise<PartnerLinkState> {
  return assertLinkState((await api<{ data: PartnerLinkState }>(partnerLinkPath(membershipId), { method: 'DELETE' })).data);
}
