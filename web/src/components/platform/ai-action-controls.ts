// IMP-X-01d — ضوابط المشغّل لإجراءات المساعد (`/platform/ai-action-controls`). الخادم هو السلطة: الواجهة لا تفترض نجاحاً وتعيد التحميل بعد كل تغيير.
// الأعلام البيئية أرضية صلبة تُعرض ولا تُحرَّر هنا (D-10)، والضوابط شرط لازم لا كافٍ: لا تمنح صلاحية ولا تتجاوز المعاينة والموافقة.

export type Capability = 'use' | 'execution';
export const CAPABILITIES: readonly Capability[] = ['use', 'execution'];

export interface ControlState {
  enabled: boolean;
  version: number;
}

export interface ControlEvent {
  action_type: string;
  capability: Capability;
  version: number;
  previous_enabled: boolean;
  new_enabled: boolean;
  reason: string;
  platform_administrator_id: string;
  occurred_at: string | null;
}

export interface PlatformControls {
  env_floor: { use: boolean; execution: boolean };
  master: Record<Capability, ControlState>;
  types: Array<{ action_type: string; state: Record<Capability, ControlState> }>;
  events: ControlEvent[];
}

export type AccessDecision = { allowed: boolean; reason: string };
export type EffectiveMatrix = Record<string, Record<'preview' | 'review' | 'execution', AccessDecision>>;

export interface TenantControls {
  tenant_id: string;
  grants: Array<{ action_type: string; capability: Capability; enabled: boolean; version: number }>;
  effective: EffectiveMatrix;
  events: ControlEvent[];
}

export const MIN_REASON = 3;
export const MAX_REASON = 500;

export function reasonValid(reason: string): boolean {
  const length = reason.trim().length;
  return length >= MIN_REASON && length <= MAX_REASON;
}

/** شكل ردّ غير متوقع (خادم أقدم/ردّ ناقص) = فشل تحميل صريح لا شاشة مكسورة. */
export function readPlatform(payload: unknown): PlatformControls | null {
  const data = (payload as { data?: PlatformControls } | null)?.data;
  if (!data || !data.env_floor || !data.master?.use || !data.master?.execution || !Array.isArray(data.types) || !Array.isArray(data.events)) return null;
  return data;
}

export function readTenant(payload: unknown): TenantControls | null {
  const data = (payload as { data?: TenantControls } | null)?.data;
  if (!data || typeof data.tenant_id !== 'string' || !Array.isArray(data.grants) || !data.effective || !Array.isArray(data.events)) return null;
  return data;
}

export function grantEnabled(data: TenantControls, actionType: string, capability: Capability): boolean {
  return data.grants.some((grant) => grant.action_type === actionType && grant.capability === capability && grant.enabled);
}

export function controlsPath(tenantId?: string): string {
  return tenantId ? `/platform/tenants/${encodeURIComponent(tenantId)}/ai-action-controls` : '/platform/ai-action-controls';
}
