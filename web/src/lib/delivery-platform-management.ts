import { deliveryPlatformPresentations, deliveryPlatformPresentation } from '@/lib/delivery-platform-registry';

/**
 * قراءة وإعداد منصات التوصيل فوق عقد DLV-FOUNDATION-1.
 * التهيئة ليست ربط API. لا يُرسل هذا الملف حالة اتصال ولا مفتاح شعار.
 */

export const PLATFORM_COLLECTION_MODES = ['platform_collected', 'merchant_collected'] as const;
export const PLATFORM_REFERENCE_POLICIES = ['required', 'optional', 'none'] as const;

export type PlatformCollectionMode = (typeof PLATFORM_COLLECTION_MODES)[number];
export type PlatformReferencePolicy = (typeof PLATFORM_REFERENCE_POLICIES)[number];

export interface PlatformBranchOverride {
  branch_id: string;
  collection_mode: string | null;
  external_reference_policy: string | null;
}

export interface PlatformProfileRecord {
  id: string;
  platform_key: string;
  is_active: boolean;
  sales_channel_slug: string | null;
  version_number: number | null;
  effective_from: string | null;
  collection_mode: string | null;
  external_reference_policy: string | null;
  display_name: string | null;
  display_name_en: string | null;
  overrides: PlatformBranchOverride[];
}

export interface PlatformManagementRow {
  key: string;
  profile: PlatformProfileRecord | null;
  status: 'unconfigured' | 'active' | 'inactive';
}

export interface PlatformDraft {
  collectionMode: PlatformCollectionMode;
  referencePolicy: PlatformReferencePolicy;
  isActive: boolean;
  displayName: string;
  displayNameEn: string;
  changeReason: string;
  overrides: PlatformBranchOverride[];
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function isMode(value: string | null | undefined): value is PlatformCollectionMode {
  return PLATFORM_COLLECTION_MODES.includes(value as PlatformCollectionMode);
}

function isPolicy(value: string | null | undefined): value is PlatformReferencePolicy {
  return PLATFORM_REFERENCE_POLICIES.includes(value as PlatformReferencePolicy);
}

export function readPlatformProfiles(value: unknown): PlatformProfileRecord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    if (typeof row.id !== 'string' || typeof row.platform_key !== 'string') return [];
    const version = row.current_version && typeof row.current_version === 'object'
      ? row.current_version as Record<string, unknown>
      : null;
    const channel = row.sales_channel && typeof row.sales_channel === 'object'
      ? row.sales_channel as Record<string, unknown>
      : null;
    const overrides = Array.isArray(version?.branch_overrides)
      ? version.branch_overrides.flatMap((override) => {
        if (!override || typeof override !== 'object') return [];
        const branch = override as Record<string, unknown>;
        if (typeof branch.branch_id !== 'string') return [];
        return [{
          branch_id: branch.branch_id,
          collection_mode: text(branch.collection_mode),
          external_reference_policy: text(branch.external_reference_policy),
        }];
      })
      : [];
    return [{
      id: row.id,
      platform_key: row.platform_key,
      is_active: row.is_active === true,
      sales_channel_slug: text(channel?.slug),
      version_number: typeof version?.version_number === 'number' ? version.version_number : null,
      effective_from: text(version?.effective_from),
      collection_mode: text(version?.collection_mode),
      external_reference_policy: text(version?.external_reference_policy),
      display_name: text(version?.display_name),
      display_name_en: text(version?.display_name_en),
      overrides,
    }];
  });
}

/** السجل المركزي يحدد الترتيب والأسماء. ملف غير معروف يُلحَق ولا يُخترع له شعار. */
export function platformManagementRows(profiles: PlatformProfileRecord[]): PlatformManagementRow[] {
  const byKey = new Map(profiles.map((profile) => [profile.platform_key, profile]));
  const keys = [
    ...deliveryPlatformPresentations().map((platform) => platform.key),
    ...profiles.map((profile) => profile.platform_key).filter((key) => deliveryPlatformPresentation(key) === null),
  ];
  return keys.map((key) => {
    const profile = byKey.get(key) ?? null;
    const status = profile === null ? 'unconfigured' : profile.is_active ? 'active' : 'inactive';
    return { key, profile, status };
  });
}

export function draftFromRow(row: PlatformManagementRow): PlatformDraft {
  const profile = row.profile;
  return {
    collectionMode: isMode(profile?.collection_mode) ? profile.collection_mode : 'merchant_collected',
    referencePolicy: isPolicy(profile?.external_reference_policy) ? profile.external_reference_policy : 'optional',
    isActive: profile?.is_active ?? true,
    displayName: profile?.display_name ?? '',
    displayNameEn: profile?.display_name_en ?? '',
    changeReason: '',
    overrides: (profile?.overrides ?? []).map((override) => ({ ...override })),
  };
}

/** حمولة الإنشاء أو التعديل. بلا شعار وبلا حقل اتصال. */
export function platformSaveBody(key: string, draft: PlatformDraft, creating: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    collection_mode: draft.collectionMode,
    external_reference_policy: draft.referencePolicy,
    is_active: draft.isActive,
    display_name: draft.displayName.trim(),
    display_name_en: draft.displayNameEn.trim(),
    change_reason: draft.changeReason.trim() || null,
    branch_overrides: draft.overrides.map((override) => ({
      branch_id: override.branch_id,
      collection_mode: override.collection_mode,
      external_reference_policy: override.external_reference_policy,
    })),
  };
  if (creating) body.platform_key = key;
  return body;
}
