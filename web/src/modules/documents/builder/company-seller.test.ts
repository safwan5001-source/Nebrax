import { describe, expect, it } from 'vitest';
import { buildDocumentSeller } from './company-seller';

describe('buildDocumentSeller', () => {
  it('maps legal identity and contact identity from one company source', () => {
    const seller = buildDocumentSeller({
      name: 'شركة نبراكس',
      name_en: 'Nebrax LLC',
      vat_number: '300000000000003',
      cr_number: '1010101010',
      unified_number: '7000000000',
      phone: '0110000000',
      mobile: '0500000000',
      email: 'info@example.com',
      website: 'https://example.com',
      building_no: '1234',
      street: 'طريق الملك فهد',
      district: 'العليا',
      city: 'الرياض',
      postal_code: '12345',
      logo: 'data:image/png;base64,AAA=',
    });

    expect(seller).toMatchObject({
      name: 'شركة نبراكس',
      nameEn: 'Nebrax LLC',
      vatNumber: '300000000000003',
      crNumber: '1010101010',
      unifiedNumber: '7000000000',
      phone: '0110000000',
      mobile: '0500000000',
      email: 'info@example.com',
      website: 'https://example.com',
      address: '1234، طريق الملك فهد، العليا، الرياض، 12345',
      logoUrl: 'data:image/png;base64,AAA=',
    });
  });

  it('keeps missing optional identity fields null and does not invent values', () => {
    const seller = buildDocumentSeller({ name: 'شركة فقط' });

    expect(seller.name).toBe('شركة فقط');
    expect(seller.nameEn).toBeNull();
    expect(seller.unifiedNumber).toBeNull();
    expect(seller.email).toBeNull();
    expect(seller.website).toBeNull();
    expect(seller.address).toBeNull();
  });

  it('prefers a template logo override without changing company identity data', () => {
    const seller = buildDocumentSeller(
      { name: 'شركة نبراكس', logo: 'company-logo' },
      { logoUrl: 'template-logo', logoHeight: 72 },
    );

    expect(seller.logoUrl).toBe('template-logo');
    expect(seller.logoHeight).toBe(72);
    expect(seller.name).toBe('شركة نبراكس');
  });
});
