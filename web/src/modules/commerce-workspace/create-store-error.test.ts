import { describe, expect, it } from 'vitest';
import { describeCreateStoreFailure } from './create-store-error';
import { commerceWorkspaceMessage } from './messages';

const fail = (extra: Record<string, unknown>) => ({ ok: false as const, message: 'raw server text', ...extra });

describe('describeCreateStoreFailure', () => {
  it('explains an unsafe tenant slug in both locales and never shows raw server text', () => {
    const f = fail({ status: 422, reason: 'tenant_slug_not_hostname_safe' });
    expect(describeCreateStoreFailure(f, 'ar')).toBe(commerceWorkspaceMessage('ar', 'createStoreSlugUnsafe'));
    expect(describeCreateStoreFailure(f, 'en')).toBe(commerceWorkspaceMessage('en', 'createStoreSlugUnsafe'));
    expect(describeCreateStoreFailure(f, 'ar')).not.toContain('raw server text');
  });

  it('maps 403, 409 and 5xx to distinct actionable messages', () => {
    expect(describeCreateStoreFailure(fail({ status: 403 }), 'ar')).toBe(commerceWorkspaceMessage('ar', 'createStoreForbidden'));
    expect(describeCreateStoreFailure(fail({ status: 409 }), 'ar')).toBe(commerceWorkspaceMessage('ar', 'createStoreConflict'));
    expect(describeCreateStoreFailure(fail({ status: 500 }), 'en')).toBe(commerceWorkspaceMessage('en', 'createStoreServerError'));
  });

  it('falls back to the generic message for network errors and unknown statuses', () => {
    expect(describeCreateStoreFailure(fail({}), 'ar')).toBe(commerceWorkspaceMessage('ar', 'createStoreFailed'));
    expect(describeCreateStoreFailure(fail({ status: 422 }), 'ar')).toBe(commerceWorkspaceMessage('ar', 'createStoreFailed'));
  });
});
