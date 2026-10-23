import { describe, expect, it } from 'vitest';
import { buildBudgetPayload, microToUsd, parseTokens, usagePercent, usdToMicro, type BudgetForm, type BudgetRow } from './ai-budgets';

const limits = { max_tokens: 1_000_000_000_000, max_cost_micro_usd: 100_000_000_000 };
const form: BudgetForm = { scope: 'global', tenantId: '', period: '2026-11', tokens: '5000000', usd: '50', password: 'pw' };

describe('usdToMicro (integer-only money)', () => {
  it.each([['50', 50_000_000], ['12.5', 12_500_000], ['0.000001', 1], ['0', 0], ['1234567.123456', 1_234_567_123_456]])('%s → %i', (input, micro) => {
    expect(usdToMicro(input)).toBe(micro);
  });
  it.each(['', '-1', '1.1234567', '1,5', 'abc', '1e3', '12345678', ' ', '.5'])('rejects %j', (input) => {
    expect(usdToMicro(input)).toBeNull();
  });
});

describe('display helpers', () => {
  it('rounds the displayed dollars up, never under-reporting', () => {
    expect(microToUsd(0)).toBe('0.00');
    expect(microToUsd(1)).toBe('0.01');
    expect(microToUsd(19_500)).toBe('0.02');
    expect(microToUsd(50_000_000)).toBe('50.00');
  });
  it('parses token counts as safe integers only', () => {
    expect(parseTokens('5000000')).toBe(5_000_000);
    expect(parseTokens('1.5')).toBeNull();
    expect(parseTokens('-3')).toBeNull();
    expect(parseTokens('99999999999999')).toBeNull();
  });
  it('shows usage as the larger of the token and cost ratios, capped at 100', () => {
    const row = { cap_tokens: 1000, used_tokens: 100, reserved_tokens: 100, cap_cost_micro_usd: 1000, used_cost_micro_usd: 700, reserved_cost_micro_usd: 100 } as BudgetRow;
    expect(usagePercent(row)).toBe(80);
    expect(usagePercent({ ...row, used_tokens: 5000 })).toBe(100);
    expect(usagePercent({ ...row, cap_tokens: 0, cap_cost_micro_usd: 0 })).toBe(100);
  });
});

describe('buildBudgetPayload', () => {
  it('builds integer caps and a global payload without a tenant id', () => {
    const result = buildBudgetPayload(form, limits, '2026-10');
    expect(result).toEqual({ ok: true, payload: { scope: 'global', period: '2026-11', cap_tokens: 5_000_000, cap_cost_micro_usd: 50_000_000, current_password: 'pw' } });
  });
  it('requires a UUID tenant for tenant scope and sends it', () => {
    expect(buildBudgetPayload({ ...form, scope: 'tenant', tenantId: 'nope' }, limits, '2026-10')).toEqual({ ok: false, error: 'tenant' });
    const id = '11111111-1111-4111-8111-111111111111';
    const ok = buildBudgetPayload({ ...form, scope: 'tenant', tenantId: id }, limits, '2026-10');
    expect(ok.ok && ok.payload.tenant_id).toBe(id);
  });
  it.each([
    [{ period: '2026-09' }, 'period'], [{ period: '2026-13' }, 'period'], [{ tokens: '1.5' }, 'tokens'], [{ usd: '1.2345678' }, 'usd'],
    [{ tokens: '2000000000000' }, 'limits'], [{ usd: '200000' }, 'limits'], [{ password: '' }, 'password'],
  ] as const)('rejects %j before any request', (override, error) => {
    expect(buildBudgetPayload({ ...form, ...override }, limits, '2026-10')).toEqual({ ok: false, error });
  });
});
