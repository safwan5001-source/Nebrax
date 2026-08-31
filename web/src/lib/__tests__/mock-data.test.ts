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

    await expect(mockApi<ZatcaSettingsResponse>('/zatca-settings')).resolves.toMatchObject({
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
    ).resolves.toMatchObject({
      data: {
        icv_scope: 'tenant',
        submission_mode: 'automatic',
        active_environment: 'simulation',
      },
    });

    await expect(mockApi<ZatcaSettingsResponse>('/zatca-settings')).resolves.toMatchObject({
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

  it('يعيد بيانات اعتماد عامة فقط مع ميتاداتا الجاهزية', async () => {
    await mockApi('/zatca-settings', 'PUT', { active_environment: 'developer' });
    const settings = await mockApi<{ meta: { signing_readiness: { ready: boolean }; transport_readiness: { ready: boolean } } }>('/zatca-settings');
    const credentials = await mockApi<{ data: Array<Record<string, unknown>> }>('/zatca-credentials');

    expect(settings.meta.signing_readiness.ready).toBe(true);
    expect(settings.meta.transport_readiness.ready).toBe(false);
    expect(credentials.data[0]).toMatchObject({
      environment: 'developer',
      has_binary_security_token: true,
      has_secret: true,
      has_private_key: true,
    });
    expect(credentials.data[0]).not.toHaveProperty('binary_security_token');
    expect(credentials.data[0]).not.toHaveProperty('secret');
    expect(credentials.data[0]).not.toHaveProperty('private_key');
  });

});

describe('mockApi POS loss-prevention Phase 4', () => {
  it('يعيد عقد Needs Attention المصفّح مع الأنواع الخمسة', async () => {
    const response = await mockApi<{
      data: Array<{ kind: string }>;
      meta: { total: number; current_page: number; last_page: number; per_page: number };
    }>('/pos/audit/needs-attention?per_page=25&page=1');

    expect(response.meta).toEqual({ total: 5, per_page: 25, current_page: 1, last_page: 1 });
    expect(response.data.map((row) => row.kind)).toEqual([
      'pending_approval',
      'priority_exception',
      'needs_investigation_exception',
      'attention_case',
      'digest_highlight',
    ]);
  });

  it('يحفظ ضوابط منع الفقد في قسم sales-config المستقل', async () => {
    const previous = await mockApi<{ data: { self_approval_blocked_for_variance: boolean; outside_hours_grace_minutes: number } }>('/sales-config/pos_loss_prevention');

    await mockApi('/sales-config/pos_loss_prevention', 'PUT', {
      data: { self_approval_blocked_for_variance: false, outside_hours_grace_minutes: 15 },
    });

    await expect(mockApi<{ data: { self_approval_blocked_for_variance: boolean; outside_hours_grace_minutes: number } }>('/sales-config/pos_loss_prevention')).resolves.toEqual({
      data: { self_approval_blocked_for_variance: false, outside_hours_grace_minutes: 15 },
    });

    await mockApi('/sales-config/pos_loss_prevention', 'PUT', { data: previous.data });
  });
});
