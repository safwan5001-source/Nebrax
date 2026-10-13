import { describe, expect, it } from 'vitest';
import { mockApi } from '@/lib/mock-data';
import { deliveryLadder, deliveryPlatformKeys, readManualStatuses, readReadinessRows } from '@/lib/integration-center';

describe('demo mode serves the delivery-platform reads (INT-UX-2)', () => {
  it('readiness mirrors the server manifest: six rows, none available, public fields only', async () => {
    const payload = await mockApi<{ data: Record<string, unknown>[] }>('/delivery-platforms/readiness');
    const readiness = readReadinessRows(payload);
    expect(readiness?.size).toBe(6);
    expect(payload.data.map((row) => row.platform_key)).toEqual(deliveryPlatformKeys());
    for (const row of payload.data) {
      expect(row.connect_enabled).toBe(false);
      expect(row.sync_enabled).toBe(false);
      expect(row).not.toHaveProperty('technical');
      expect(row).not.toHaveProperty('evidence_ref');
    }
    for (const key of deliveryPlatformKeys()) {
      expect(deliveryLadder(key, new Map(), readiness).b).not.toBe('available');
    }
  });

  it('profiles are a readable empty list, not a failure', async () => {
    const manual = readManualStatuses(await mockApi('/delivery-platforms'));
    expect(manual).not.toBeNull();
    expect(manual?.size).toBe(0);
  });
});
