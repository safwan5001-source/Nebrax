import { describe, expect, it } from 'vitest';
import { mockApi } from '../mock-data';

interface ZatcaSettingsResponse {
  data: {
    icv_scope: 'tenant';
    submission_mode: 'manual' | 'automatic';
  };
}

describe('mockApi ZATCA settings', () => {
  it('يعيد الوضع اليدوي افتراضياً ويحفظ تغيير وضع الإرسال في جلسة المعاينة', async () => {
    await mockApi<ZatcaSettingsResponse>('/zatca-settings', 'PUT', {
      submission_mode: 'manual',
    });

    await expect(mockApi<ZatcaSettingsResponse>('/zatca-settings')).resolves.toEqual({
      data: {
        icv_scope: 'tenant',
        submission_mode: 'manual',
      },
    });

    await expect(
      mockApi<ZatcaSettingsResponse>('/zatca-settings', 'PUT', {
        submission_mode: 'automatic',
      }),
    ).resolves.toEqual({
      data: {
        icv_scope: 'tenant',
        submission_mode: 'automatic',
      },
    });

    await expect(mockApi<ZatcaSettingsResponse>('/zatca-settings')).resolves.toEqual({
      data: {
        icv_scope: 'tenant',
        submission_mode: 'automatic',
      },
    });
  });
});
