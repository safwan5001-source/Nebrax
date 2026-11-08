import { describe, expect, it } from 'vitest';
import { normalizeDefinition } from './template-definition';

describe('normalizeDefinition — الحفظ لا يُسقط أي خاصية للقالب (AWJ-DOC-V2-PR3B)', () => {
  const migrated = {
    template_id: 'tax-invoice-classic-v2',
    theme_id: 'violet' as const,
    show_logo: false,
    footer_text: 'تذييل',
    layout: [{ key: 'header' as const, visible: true }],
    stamp: 'https://cdn.example/stamp.png',
    signature: 'https://cdn.example/sign.png',
    terms_text: 'الشروط',
    bank_text: 'IBAN SA00',
    logo_height: 48,
    page: { size: 'a4', direction: 'rtl' },
    output_profile: { version: 1, paper: 'a5', orientation: 'portrait', output_mode: 'page', margins_mm: { top: 10, right: 10, bottom: 10, left: 10 } },
    future_key: { anything: [1, 2, 3] },
  };

  it('يحتفظ بكل مفاتيح تعريف قالب مهاجَر (ختم/توقيع/شروط/بنك/شعار/صفحة/ملف إخراج/مفتاح مستقبلي)', () => {
    const out = normalizeDefinition({ definition: migrated }, 'tax_invoice');
    expect(out).toEqual(migrated);
  });

  it('يملأ الحقول المعروفة الناقصة بافتراضاتها دون المساس بالباقي', () => {
    const out = normalizeDefinition({ definition: { stamp: 's', output_profile: { paper: 'a4' } } }, 'tax_invoice');
    expect(out.template_id).toBe('tax-invoice-classic');
    expect(out.theme_id).toBe('blue');
    expect(out.show_logo).toBe(true);
    expect(out.footer_text).toBe('');
    expect(out.layout?.length).toBeGreaterThan(0);
    expect((out as Record<string, unknown>).stamp).toBe('s');
    expect(out.output_profile).toEqual({ paper: 'a4' });
  });

  it('مسودة بلا تعريف: افتراضات فقط ولا مفتاح output_profile', () => {
    const out = normalizeDefinition({ definition: null }, 'quotation');
    expect(Object.keys(out).sort()).toEqual(['footer_text', 'layout', 'show_logo', 'template_id', 'theme_id']);
  });

  it('مسح ملف الإخراج (undefined) لا يتركه في الجسم المُرسَل', () => {
    const out = normalizeDefinition({ definition: { ...migrated, output_profile: undefined } }, 'tax_invoice');
    expect(JSON.parse(JSON.stringify(out))).not.toHaveProperty('output_profile');
  });

  it('لا يعدّل المدخل', () => {
    const input = { definition: { ...migrated } };
    const snapshot = JSON.stringify(input);
    normalizeDefinition(input, 'tax_invoice');
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
