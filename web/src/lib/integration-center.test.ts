import { describe, expect, it } from 'vitest';
import {
  INTEGRATION_CATEGORIES,
  deliverySummary,
  isApplicationHidden,
  readNativeAvailableCount,
  readSetUpCount,
} from '@/lib/integration-center';

describe('integration center categories', () => {
  it('keeps the approved order and only delivery platforms is enterable', () => {
    expect(INTEGRATION_CATEGORIES.map((c) => c.key)).toEqual(['delivery', 'ecommerce', 'payments', 'shipping']);
    expect(INTEGRATION_CATEGORIES.filter((c) => c.href !== null).map((c) => c.key)).toEqual(['delivery']);
  });

  it('enters the existing delivery platforms section and creates no duplicate route', () => {
    const delivery = INTEGRATION_CATEGORIES.find((c) => c.key === 'delivery');
    expect(delivery?.href).toBe('/delivery-platforms');
    expect(INTEGRATION_CATEGORIES.some((c) => c.href?.startsWith('/integrations'))).toBe(false);
  });
});

describe('isApplicationHidden', () => {
  it('hides only on an explicit false', () => {
    expect(isApplicationHidden({ data: { 'sales.pos': false } }, 'sales.pos')).toBe(true);
    expect(isApplicationHidden({ data: { 'sales.pos': true } }, 'sales.pos')).toBe(false);
  });

  it('never hides on a missing key or an unreadable payload (the server still guards the routes)', () => {
    expect(isApplicationHidden({ data: {} }, 'sales.pos')).toBe(false);
    expect(isApplicationHidden({ data: [] }, 'sales.pos')).toBe(false);
    expect(isApplicationHidden(null, 'sales.pos')).toBe(false);
    expect(isApplicationHidden('x', 'sales.pos')).toBe(false);
  });
});

describe('readSetUpCount (ladder step A)', () => {
  it('counts the active known platforms once each', () => {
    expect(readSetUpCount({
      data: [
        { platform_key: 'keeta', is_active: true },
        { platform_key: 'jahez', is_active: false },
        { platform_key: 'jahez', is_active: true },
        { platform_key: 'keeta', is_active: true },
        { platform_key: 'unknown-platform', is_active: true },
      ],
    })).toBe(2);
  });

  it('is zero for a readable empty list and null for an unreadable payload', () => {
    expect(readSetUpCount({ data: [] })).toBe(0);
    expect(readSetUpCount(null)).toBeNull();
    expect(readSetUpCount({})).toBeNull();
    expect(readSetUpCount({ data: {} })).toBeNull();
    expect(readSetUpCount([])).toBeNull();
  });

  it('does not treat a truthy non-boolean as active', () => {
    expect(readSetUpCount({ data: [{ platform_key: 'keeta', is_active: 1 }] })).toBe(0);
  });
});

describe('readNativeAvailableCount (ladder step B)', () => {
  const six = (state: string) => ['hungerstation', 'jahez', 'mrsool', 'keeta', 'ninja', 'the_chefz']
    .map((platform_key) => ({ platform_key, ux_state: state }));

  it('is zero when no provider is ready to connect (today: all six)', () => {
    expect(readNativeAvailableCount({
      data: [
        ...six('NOT_SUPPORTED').slice(0, 3),
        ...six('AWAITING_PROVIDER_APPROVAL').slice(3),
      ],
    })).toBe(0);
  });

  it('counts only READY_TO_CONNECT and reads no internal evidence field', () => {
    expect(readNativeAvailableCount({
      data: [
        { platform_key: 'keeta', ux_state: 'READY_TO_CONNECT', connect_enabled: false },
        { platform_key: 'jahez', ux_state: 'NOT_SUPPORTED', technical: 'READY' },
      ],
    })).toBe(1);
  });

  it('is null (not zero) for an unreadable or incomplete payload so no false claim is made', () => {
    expect(readNativeAvailableCount(null)).toBeNull();
    expect(readNativeAvailableCount({ data: [] })).toBeNull();
    expect(readNativeAvailableCount({ data: [{ platform_key: 'keeta' }] })).toBeNull();
    expect(readNativeAvailableCount({ data: [{ ux_state: 'NOT_SUPPORTED' }, { platform_key: 'x' }] })).toBeNull();
  });
});

describe('deliverySummary', () => {
  it('combines both reads independently and reports the registry total', () => {
    expect(deliverySummary({ data: [{ platform_key: 'keeta', is_active: true }] }, null)).toEqual({
      setUp: 1,
      total: 6,
      nativeAvailable: null,
    });
    expect(deliverySummary(null, { data: [{ ux_state: 'NOT_SUPPORTED' }] })).toEqual({
      setUp: null,
      total: 6,
      nativeAvailable: 0,
    });
  });
});
