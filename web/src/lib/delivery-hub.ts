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
}

export function deliveryHubActions(input: {
  state: DeliveryHubState;
  canOperate: boolean;
  canSeeUnrouted: boolean;
  branchCount: number;
}): DeliveryHubAction[] {
  if (!input.canOperate) return [];

  if (input.state === 'cancelled_before_post') return [];

  if (input.state === 'unrouted') {
    if (!input.canSeeUnrouted) return [];
    const actions: DeliveryHubAction[] = [];
    if (input.branchCount > 0) actions.push('route');
    actions.push('cancel', 'reject');
    return actions;
  }

  if (input.state === 'received') {
    const actions: DeliveryHubAction[] = ['accept'];
    if (input.branchCount > 1) actions.push('reroute');
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

export function deliveryHubPlatformLabel(order: Pick<DeliveryHubOrderView, 'platform_name' | 'platform_name_en' | 'platform_key'>, locale: string): string {
  if (locale === 'en') return order.platform_name_en || order.platform_name || order.platform_key || '';
  return order.platform_name || order.platform_name_en || order.platform_key || '';
}
