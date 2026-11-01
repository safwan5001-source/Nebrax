import { api } from '@/lib/api';
import { channelSettingsPath } from '../wholesale/channel';

/**
 * B2C customer accounts — per-channel switch. Reuses the existing staff endpoint
 * `GET/PUT /commerce/channels/{id}/pricing-settings` (permission `commerce.channel_settings.manage`, owner/admin
 * only); no new backend. The tenant is the session's; the browser never sends one. The deployment flag
 * (`commerce.retail_accounts_enabled`) is read-only here and only ever reported by the server.
 */

export type CustomerAccountChange = {
  at: string | null;
  actor: { id: string; name: string } | null;
  changes: Record<string, { from: unknown; to: unknown }>;
};

export type CustomerAccountSettings = {
  id: string;
  name: string;
  type: string;
  /** Persisted per-channel switch (`sales_channels.customer_accounts_enabled`). */
  customer_accounts_enabled: boolean;
  /** Deployment master switch (`commerce.retail_accounts_enabled`), read-only. */
  customer_accounts_deployment_enabled: boolean;
  recent_changes?: CustomerAccountChange[];
};

export async function fetchCustomerAccountSettings(channelId: string): Promise<CustomerAccountSettings> {
  const response = await api<{ data: CustomerAccountSettings }>(channelSettingsPath(channelId));
  return response.data;
}

/** Writes only `customer_accounts_enabled` (the server refuses a tenant override and an empty body). */
export async function saveCustomerAccountsEnabled(channelId: string, enabled: boolean): Promise<CustomerAccountSettings> {
  const response = await api<{ data: CustomerAccountSettings }>(channelSettingsPath(channelId), {
    method: 'PUT',
    body: { customer_accounts_enabled: enabled },
  });
  return response.data;
}

/**
 * What shoppers can actually do, from the two persisted facts:
 *  - `active`: channel on AND deployment open → registration and login are available;
 *  - `inactive`: channel off → no registration or login, guest checkout unaffected;
 *  - `gated_on`: channel on but the deployment gate is closed → still unavailable to shoppers;
 *  - `gated_off`: channel off and the gate is closed → cannot be turned on until the platform opens it.
 */
export type CustomerAccountsStatus = 'active' | 'inactive' | 'gated_on' | 'gated_off';

export function deriveStatus(settings: Pick<CustomerAccountSettings, 'customer_accounts_enabled' | 'customer_accounts_deployment_enabled'>): CustomerAccountsStatus {
  const channelOn = settings.customer_accounts_enabled === true;
  const deploymentOn = settings.customer_accounts_deployment_enabled === true;
  if (channelOn) return deploymentOn ? 'active' : 'gated_on';
  return deploymentOn ? 'inactive' : 'gated_off';
}

/** Tolerant shape check: a malformed payload must never read as "enabled". */
export function isCustomerAccountSettings(value: unknown): value is CustomerAccountSettings {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === 'string' && typeof v.customer_accounts_enabled === 'boolean' && typeof v.customer_accounts_deployment_enabled === 'boolean';
}
