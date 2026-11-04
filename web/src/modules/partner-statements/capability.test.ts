import { describe, expect, it } from 'vitest';
import { resolveCapability } from './capability';

describe('capability resolution', () => {
  it('defaults to enabled when nothing is known (server stays the arbiter)', () => {
    expect(resolveCapability({})).toBe('enabled');
    expect(resolveCapability({ navVisible: null, appStatus: null })).toBe('enabled');
  });

  it('treats a hidden nav entry as disabled', () => {
    expect(resolveCapability({ navVisible: false })).toBe('disabled');
    expect(resolveCapability({ navVisible: true })).toBe('enabled');
  });

  it('uses the explicit application status when nav-state does not hide the capability', () => {
    expect(resolveCapability({ appStatus: 'suspended', navVisible: true })).toBe('suspended');
    expect(resolveCapability({ appStatus: 'suspended', navVisible: null })).toBe('suspended');
  });

  it('lets nav-state hiding win even when the tenant enabled it (commercial entitlement missing)', () => {
    expect(resolveCapability({ appStatus: 'enabled', navVisible: false })).toBe('disabled');
  });

  it('lets what the server just answered override everything', () => {
    expect(resolveCapability({ observed: 'suspended', appStatus: 'enabled' })).toBe('suspended');
    expect(resolveCapability({ observed: 'disabled', navVisible: true })).toBe('disabled');
  });
});
