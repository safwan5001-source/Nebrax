import type { OwnerCompanyLink, Tanker, TankerOwner } from './types';

/** بيانات اصطناعية فقط (لا أسماء أو أرقام حقيقية). */
export const OWNER_ID = '11111111-1111-4111-8111-111111111111';
export const TANKER_ID = '22222222-2222-4222-8222-222222222222';
export const LINK_ID = '33333333-3333-4333-8333-333333333333';
export const PARTNER_A = '44444444-4444-4444-8444-444444444444';
export const PARTNER_B = '55555555-5555-4555-8555-555555555555';

export const owner = (extra: Partial<TankerOwner> = {}): TankerOwner => ({
  id: OWNER_ID, code: 'TO-1', name: 'مالك تجريبي', status: 'active', phone: '0500000000', notes: 'ملاحظة داخلية', created_at: '2026-01-05T09:00:00Z', ...extra,
});

export const tanker = (extra: Partial<Tanker> = {}): Tanker => ({
  id: TANKER_ID, fuel_tanker_owner_id: OWNER_ID, plate_number: 'ABC 1234', plate_country: 'SA', capacity_milliliters: 30000000, status: 'active', notes: null, created_at: '2026-01-06T09:00:00Z', ...extra,
});

export const link = (extra: Partial<OwnerCompanyLink> = {}): OwnerCompanyLink => ({
  id: LINK_ID, fuel_tanker_owner_id: OWNER_ID, partner_id: PARTNER_A, partner: { id: PARTNER_A, name: 'شركة أ' }, valid_from: '2026-01-01', valid_to: null, is_active: true, note: null, end_reason: null, created_at: '2026-01-01T00:00:00Z', ...extra,
});

export const page = <T,>(rows: T[], meta: { current_page?: number; last_page?: number; total?: number } = {}) => ({
  data: rows,
  meta: { current_page: meta.current_page ?? 1, last_page: meta.last_page ?? 1, per_page: 50, total: meta.total ?? rows.length },
});
