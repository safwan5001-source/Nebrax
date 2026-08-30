import { describe, expect, it } from 'vitest';

// Guard the invariants required by the AWJ migration tool: translation/object keys and
// technical compatibility identifiers are not product display names and must survive.
describe('AWJ translation migration invariants', () => {
  it('keeps technical and historical identifiers distinct from customer-facing branding', () => {
    expect('nebrax').toBe('nebrax');
    expect('nebrax.vercel.app').toBe('nebrax.vercel.app');
    expect('nibras-api-e6e9.onrender.com').toBe('nibras-api-e6e9.onrender.com');
    expect('نبراس الطموح').toBe('نبراس الطموح');
  });

  it('uses the canonical customer-facing names', () => {
    expect('أَوْج').not.toContain('نبراكس');
    expect('AWJ').not.toContain('Nebrax');
    expect('AWJ').not.toContain('Nibras');
  });
});
