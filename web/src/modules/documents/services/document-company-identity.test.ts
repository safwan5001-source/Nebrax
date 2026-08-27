import { describe, expect, it } from 'vitest';
import { buildDocumentCompanyIdentity } from './document-company-identity';

describe('buildDocumentCompanyIdentity', () => {
  it('يفصل الهوية القانونية عن بيانات التواصل ويحذف القيم الفارغة', () => {
    const identity = buildDocumentCompanyIdentity({
      name: 'شركة نبراكس',
      name_en: 'Nebrax Company',
      vat_number: '310123456700003',
      cr_number: '2050123456',
      building_no: '1234',
      street: 'طريق الملك فهد',
      district: 'الروضة',
      city: 'الدمام',
      postal_code: '32241',
      phone: '0130000000',
      mobile: null,
      email: 'info@example.com',
      website: 'example.com',
      support_number: 920000000,
      logo: 'data:image/png;base64,logo',
    });

    expect(identity.nameAr).toBe('شركة نبراكس');
    expect(identity.nameEn).toBe('Nebrax Company');
    expect(identity.legal.map((field) => field.key)).toEqual(['vat_number', 'cr_number', 'address']);
    expect(identity.contact.map((field) => field.key)).toEqual(['phone', 'email', 'website', 'support_number']);
    expect(identity.legal.some((field) => field.key === ('phone' as never))).toBe(false);
  });

  it('لا ينتج أسطراً فارغة ويحافظ على دعم الهوية الحالية قبل إضافة الحقول الجديدة', () => {
    const identity = buildDocumentCompanyIdentity({
      name: 'نبراكس',
      vat_number: null,
      cr_number: null,
      short_address: 'الدمام، السعودية',
      phone: null,
      mobile: null,
      logo: null,
    });

    expect(identity.nameEn).toBeNull();
    expect(identity.legal).toEqual([{ key: 'address', value: 'الدمام، السعودية' }]);
    expect(identity.contact).toEqual([]);
    expect(identity.logoUrl).toBeNull();
  });
});
