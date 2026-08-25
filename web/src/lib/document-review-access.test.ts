import { describe, expect, it } from 'vitest';
import { canViewDocumentCenter } from './document-review-access';

describe('Document Center sidebar access', () => {
  it('shows the entry only for an explicit view permission or an administrative fallback role', () => {
    expect(canViewDocumentCenter(['documents.center.view'], 'staff')).toBe(true);
    expect(canViewDocumentCenter([], 'staff')).toBe(false);
    expect(canViewDocumentCenter(undefined, 'owner')).toBe(true);
  });
});
