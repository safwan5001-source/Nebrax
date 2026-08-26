import { describe, expect, it } from 'vitest';
import { isExplicitSectionVisible } from './document-body';

describe('isExplicitSectionVisible', () => {
  it('keeps commercial default sections visible when a legacy invoice config omits them', () => {
    expect(isExplicitSectionVisible('terms', {})).toBe(true);
    expect(isExplicitSectionVisible('notes', { summary: true })).toBe(true);
    expect(isExplicitSectionVisible('bank', { qr: false })).toBe(true);
  });

  it('honours an explicitly hidden block when no saved layout is present', () => {
    expect(isExplicitSectionVisible('summary', { summary: false })).toBe(false);
    expect(isExplicitSectionVisible('terms', { terms: false })).toBe(false);
    expect(isExplicitSectionVisible('signature', { signature: false })).toBe(false);
  });

  it('keeps the shared parties block unless seller, buyer and metadata are all explicitly hidden', () => {
    expect(isExplicitSectionVisible('parties', { seller: false })).toBe(true);
    expect(isExplicitSectionVisible('parties', { seller: false, buyer: false, meta: false })).toBe(false);
  });
});
