import { describe, expect, it } from 'vitest';
import { getTemplate, listTemplatesForDocumentType, templateSupportsDocumentType } from './templates';
import { outputProfileFit, resolveDocumentOutputSpec } from '../services/output-spec';
import { normalizeOutputProfile } from '../../print-templates/services/output-profile';

const ID = 'voucher-compact';

function profile(input: Record<string, unknown>) {
  const result = normalizeOutputProfile(input);
  if (!result.ok) throw new Error('invalid profile in test');
  return result.profile;
}

describe('سجلّ القالب voucher-compact (AWJ-DOC-V2-PR5)', () => {
  it('يخص سندي القبض والصرف فقط', () => {
    const t = getTemplate(ID);
    expect(t.id).toBe(ID);
    expect(t.documentTypes).toEqual(['receipt_voucher', 'payment_voucher']);
    expect(templateSupportsDocumentType(t, 'receipt_voucher')).toBe(true);
    expect(templateSupportsDocumentType(t, 'payment_voucher')).toBe(true);
    for (const other of ['tax_invoice', 'quotation', 'purchase_invoice', 'credit_note', 'delivery_note'] as const) {
      expect(listTemplatesForDocumentType(other).map((d) => d.id)).not.toContain(ID);
    }
    expect(listTemplatesForDocumentType('receipt_voucher').map((d) => d.id)).toContain(ID);
  });

  it('بلا ملف إخراج يبقى A4 (المقاس الأول المعلن) كما سائر القوالب', () => {
    const spec = resolveDocumentOutputSpec(ID, null);
    expect(spec.profile).toBeNull();
    expect(spec.paper).toMatchObject({ widthMm: 210, heightMm: 297 });
  });

  it('المقاسات المعلنة: A4/A4 أفقي وA5 بالاتجاهين وA6 أفقي فقط', () => {
    expect(getTemplate(ID).supportedPaper).toEqual(['a4', 'a4_landscape', 'a5', 'a5_landscape', 'a6_landscape']);
    for (const input of [{ paper: 'a4' }, { paper: 'a4', orientation: 'landscape' }, { paper: 'a5' }, { paper: 'a5', orientation: 'landscape' }, { paper: 'a6', orientation: 'landscape' }]) {
      expect(outputProfileFit(profile(input), ID)).toEqual({ supported: true });
    }
  });

  it('A6 عمودي وLetter/Legal وحراري غير معلنة فتُرفض (السلوك السابق)', () => {
    expect(outputProfileFit(profile({ paper: 'a6' }), ID)).toMatchObject({ supported: false, reason: 'paper_not_supported' });
    expect(outputProfileFit(profile({ paper: 'letter' }), ID)).toMatchObject({ supported: false });
    expect(outputProfileFit(profile({ paper: 'legal' }), ID)).toMatchObject({ supported: false });
    expect(resolveDocumentOutputSpec(ID, profile({ paper: 'a6' })).profile).toBeNull();
  });

  it('هوامش تضيّق المحتوى دون 128مم تُسقط الدعم', () => {
    expect(outputProfileFit(profile({ paper: 'a5', margins_mm: { top: 10, right: 20, bottom: 10, left: 20 } }), ID)).toMatchObject({ supported: false, reason: 'content_too_narrow', minContentWidthMm: 128 });
  });

  it('المقاس المفضَّل مقاس معلن فعلاً ومدعوم', () => {
    const t = getTemplate(ID);
    expect(t.preferredOutput).toEqual({ paper: 'a5', orientation: 'landscape' });
    expect(t.supportedPaper).toContain('a5_landscape');
    expect(outputProfileFit(profile({ ...t.preferredOutput! }), ID)).toEqual({ supported: true });
  });

  it('قوالب الفاتورة التاريخية بلا مقاس مفضَّل (لا أثر على A4)', () => {
    for (const id of ['tax-invoice-classic', 'tax-invoice-classic-v2', 'quotation-proposal', 'purchase-order-formal', 'tax-invoice-thermal80']) {
      expect(getTemplate(id).preferredOutput).toBeUndefined();
    }
  });
});
