import { describe, expect, it } from 'vitest';
import { mockApi } from '../mock-data';

interface ZatcaSettingsResponse {
  data: {
    icv_scope: 'tenant';
    submission_mode: 'manual' | 'automatic';
    active_environment: 'developer' | 'simulation' | 'production';
  };
}

describe('mockApi ZATCA settings', () => {
  it('يعيد الوضع اليدوي افتراضياً ويحفظ تغيير وضع الإرسال في جلسة المعاينة', async () => {
    await mockApi<ZatcaSettingsResponse>('/zatca-settings', 'PUT', {
      submission_mode: 'manual',
      active_environment: 'developer',
    });

    await expect(mockApi<ZatcaSettingsResponse>('/zatca-settings')).resolves.toEqual({
      data: {
        icv_scope: 'tenant',
        submission_mode: 'manual',
        active_environment: 'developer',
      },
    });

    await expect(
      mockApi<ZatcaSettingsResponse>('/zatca-settings', 'PUT', {
        submission_mode: 'automatic',
        active_environment: 'simulation',
      }),
    ).resolves.toEqual({
      data: {
        icv_scope: 'tenant',
        submission_mode: 'automatic',
        active_environment: 'simulation',
      },
    });

    await expect(mockApi<ZatcaSettingsResponse>('/zatca-settings')).resolves.toEqual({
      data: {
        icv_scope: 'tenant',
        submission_mode: 'automatic',
        active_environment: 'simulation',
      },
    });
  });
  it('يعرض إتاحة تطبيق ZATCA من عقد nav-state في وضع المعاينة', async () => {
    const response = await mockApi<{ data: Record<string, boolean> }>('/applications/nav-state');

    expect(response.data['compliance.zatca']).toBe(true);
  });

});
