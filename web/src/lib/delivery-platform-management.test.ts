import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { deliveryPlatformPresentations } from './delivery-platform-registry';
import {
  draftFromRow,
  platformManagementRows,
  platformSaveBody,
  readPlatformProfiles,
} from './delivery-platform-management';

describe('delivery platform management', () => {
  it('lists the six canonical platforms from the registry before any profile exists', () => {
    const rows = platformManagementRows(readPlatformProfiles([]));
    expect(rows.map((row) => row.key)).toEqual(deliveryPlatformPresentations().map((platform) => platform.key));
    expect(rows.every((row) => row.status === 'unconfigured')).toBe(true);
    expect(deliveryPlatformPresentations().every((platform) => platform.logoSrc?.startsWith('/delivery-platforms/'))).toBe(true);
  });

  it('rejects a demo array and keeps an active profile distinct from an inactive one', () => {
    expect(readPlatformProfiles([])).toEqual([]);
    const rows = platformManagementRows(readPlatformProfiles([
      {
        id: 'profile-jahez',
        platform_key: 'jahez',
        is_active: true,
        sales_channel: { slug: 'delivery-jahez' },
        current_version: {
          version_number: 2,
          collection_mode: 'platform_collected',
          external_reference_policy: 'required',
          display_name: 'جاهز',
          display_name_en: 'Jahez',
          effective_from: '2026-10-03T00:00:00.000000Z',
          branch_overrides: [{ branch_id: 'branch-a', collection_mode: 'merchant_collected', external_reference_policy: 'optional' }],
        },
      },
      { id: 'profile-keeta', platform_key: 'keeta', is_active: false, current_version: null },
    ]));
    expect(rows.find((row) => row.key === 'jahez')?.status).toBe('active');
    expect(rows.find((row) => row.key === 'keeta')?.status).toBe('inactive');
    expect(rows.find((row) => row.key === 'jahez')?.profile?.overrides).toEqual([
      { branch_id: 'branch-a', collection_mode: 'merchant_collected', external_reference_policy: 'optional' },
    ]);
    expect(rows.find((row) => row.key === 'hungerstation')?.status).toBe('unconfigured');
  });

  it('saves configuration only and never a connector or logo field', () => {
    const row = platformManagementRows([])[1];
    const body = platformSaveBody('jahez', {
      ...draftFromRow(row),
      collectionMode: 'platform_collected',
      isActive: false,
      overrides: [{ branch_id: 'branch-a', collection_mode: 'platform_collected', external_reference_policy: 'optional' }],
    }, true);
    expect(body.platform_key).toBe('jahez');
    expect(body.selling_role).toBe('unknown');
    expect(body.invoice_responsibility).toBe('unknown');
    expect(body.collection_role).toBe('unknown');
    expect(body.merchant_vat_status_at_supply).toBe('unknown');
    expect(body).not.toHaveProperty('financial_verified_at');
    expect(body).not.toHaveProperty('posting_authorized');
    expect(body).not.toHaveProperty('logo_asset_key');
    expect(body).not.toHaveProperty('connected');
    expect(JSON.stringify(body)).not.toMatch(/webhook|credential|connector/i);
    const ar = readFileSync(new URL('../messages/ar.json', import.meta.url), 'utf8');
    const en = readFileSync(new URL('../messages/en.json', import.meta.url), 'utf8');
    expect(ar).not.toContain('جاهز للترحيل');
    expect(en).not.toMatch(/Ready for financial posting/i);
  });
});
