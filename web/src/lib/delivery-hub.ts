import { deliveryPlatformLabel } from './delivery-platform-registry';

export const DELIVERY_HUB_STATES = [
  'unrouted',
  'received',
  'accepted',
  'preparing',
  'ready',
  'handed_off',
  'cancelled_before_post',
] as const;

export type DeliveryHubState = (typeof DELIVERY_HUB_STATES)[number];

export type DeliveryHubAction = 'route' | 'reroute' | 'accept' | 'preparing' | 'ready' | 'handoff' | 'reject' | 'cancel';

export interface DeliveryHubOrderView {
  id: string;
  state: DeliveryHubState;
  branch_id: string | null;
  branch_name: string | null;
  delivery_platform_profile_id: string;
  platform_key: string | null;
  platform_name: string | null;
  platform_name_en: string | null;
  provider_order_id: string | null;
  external_order_reference: string | null;
  idempotency_key: string | null;
  provider_status: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface DeliveryHubBranchOption {
  id: string;
  name: string;
  is_active: boolean;
}

export function deliveryHubActions(input: {
  state: DeliveryHubState;
  canOperate: boolean;
  canSeeUnrouted: boolean;
  destinationCount: number;
}): DeliveryHubAction[] {
  if (!input.canOperate) return [];

  if (input.state === 'cancelled_before_post') return [];

  if (input.state === 'unrouted') {
    if (!input.canSeeUnrouted) return [];
    const actions: DeliveryHubAction[] = [];
    if (input.destinationCount > 0) actions.push('route');
    actions.push('cancel', 'reject');
    return actions;
  }

  if (input.state === 'received') {
    const actions: DeliveryHubAction[] = ['accept'];
    if (input.destinationCount > 0) actions.push('reroute');
    actions.push('cancel', 'reject');
    return actions;
  }

  const forward: Partial<Record<DeliveryHubState, DeliveryHubAction>> = {
    accepted: 'preparing',
    preparing: 'ready',
    ready: 'handoff',
  };
  const next = forward[input.state];
  return next ? [next, 'cancel', 'reject'] : ['cancel', 'reject'];
}

export function deliveryHubPlatformLabel(
  order: Pick<DeliveryHubOrderView, 'platform_name' | 'platform_name_en' | 'platform_key'>,
  locale: string,
): string {
  return deliveryPlatformLabel(order.platform_key, locale, {
    name: order.platform_name,
    nameEn: order.platform_name_en,
  });
}

/** استعلام القائمة الموجود فقط. بلا بحث: واجهة الإسقاط لا تقبل مرجعاً نصياً. */
export function deliveryHubListPath(input: {
  state: DeliveryHubState | 'all';
  platformId: string;
  branchId: string;
  page: number;
  perPage?: number;
}): string {
  const params = new URLSearchParams({
    per_page: String(input.perPage ?? 50),
    page: String(Math.max(1, input.page)),
  });
  if (input.state === 'unrouted') params.set('unrouted', '1');
  else if (input.state !== 'all') params.set('state', input.state);
  if (input.platformId) params.set('delivery_platform_profile_id', input.platformId);
  if (input.branchId) params.set('branch_id', input.branchId);
  return `/delivery-hub/orders?${params.toString()}`;
}

/** سياق المعاينة يعيد مصفوفة فارغة. لا نمرّرها ككائن حتى لا تنهار القائمة. */
export function readHubContext(value: unknown): {
  can_see_unrouted: boolean;
  platforms: Array<{ id: string; platform_key: string; name: string | null; name_en: string | null }>;
  branches: DeliveryHubBranchOption[];
} {
  const empty = {
    can_see_unrouted: false,
    platforms: [] as Array<{ id: string; platform_key: string; name: string | null; name_en: string | null }>,
    branches: [] as DeliveryHubBranchOption[],
  };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return empty;
  const row = value as { can_see_unrouted?: unknown; platforms?: unknown; branches?: unknown };
  const platforms = Array.isArray(row.platforms)
    ? row.platforms.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const platform = item as { id?: unknown; platform_key?: unknown; name?: unknown; name_en?: unknown };
      if (typeof platform.id !== 'string' || typeof platform.platform_key !== 'string') return [];
      return [{
        id: platform.id,
        platform_key: platform.platform_key,
        name: typeof platform.name === 'string' ? platform.name : null,
        name_en: typeof platform.name_en === 'string' ? platform.name_en : null,
      }];
    })
    : [];
  const branches = Array.isArray(row.branches)
    ? row.branches.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const branch = item as { id?: unknown; name?: unknown; is_active?: unknown };
      if (typeof branch.id !== 'string' || typeof branch.name !== 'string') return [];
      return [{ id: branch.id, name: branch.name, is_active: branch.is_active === true }];
    })
    : [];
  return { can_see_unrouted: row.can_see_unrouted === true, platforms, branches };
}

export function readHubOrders(value: unknown): DeliveryHubOrderView[] {
  return Array.isArray(value) ? value as DeliveryHubOrderView[] : [];
}
