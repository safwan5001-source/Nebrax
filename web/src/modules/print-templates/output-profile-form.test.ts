import { describe, expect, it } from 'vitest';
import {
  emptyForm,
  evaluateOutputProfileForm,
  formFromProfile,
  formWithPaper,
  outputProfileAfterTemplateChange,
  outputProfileUnwiredTypes,
  paperChoicesForTemplate,
  type OutputProfileForm,
} from './output-profile-form';
import { normalizeOutputProfile } from './services/output-profile';

const CLASSIC = 'tax-invoice-classic';
const CLASSIC_V2 = 'tax-invoice-classic-v2';
const ERP_V2 = 'tax-invoice-erp-v2';

const form = (patch: Partial<OutputProfileForm>): OutputProfileForm => ({ ...emptyForm(), ...patch });

describe('paperChoicesForTemplate', () => {
  it('classic: A4/A5/Letter/Legal، الاتجاه الأفقي لـA4 وA5 فقط، بلا A6، والمخصص متاح', () => {
    const choices = paperChoicesForTemplate(CLASSIC);
    expect(choices.thermal).toBeNull();
    expect(choices.custom).toBe(true);
    const map = Object.fromEntries(choices.papers.map((item) => [item.id, item.orientations]));
    expect(map).toEqual({ a4: ['portrait', 'landscape'], a5: ['landscape'], letter: ['portrait'], legal: ['portrait'] });
  });

  it('classic-v2: A5 عمودي وأفقي وA6 أفقي فقط', () => {
    const map = Object.fromEntries(paperChoicesForTemplate(CLASSIC_V2).papers.map((item) => [item.id, item.orientations]));
    expect(map.a5).toEqual(['portrait', 'landscape']);
    expect(map.a6).toEqual(['landscape']);
  });

  it('erp-v2: A6 أفقي فقط ولا A5 عمودي', () => {
    const map = Object.fromEntries(paperChoicesForTemplate(ERP_V2).papers.map((item) => [item.id, item.orientations]));
    expect(map.a6).toEqual(['landscape']);
    expect(map.a5).toEqual(['landscape']);
  });

  it('الحراري: مقاس القالب ثابت ولا اختيارات', () => {
    expect(paperChoicesForTemplate('tax-invoice-thermal80')).toEqual({ thermal: 'thermal_80', papers: [], custom: false });
    expect(paperChoicesForTemplate('tax-invoice-thermal58').thermal).toBe('thermal_58');
  });
});

describe('evaluateOutputProfileForm', () => {
  it('«افتراضي القالب» = مسح الملف', () => {
    expect(evaluateOutputProfileForm(form({ paper: 'default' }), CLASSIC)).toEqual({ profile: null, clear: true, errors: [] });
  });

  it('A4 بلا هوامش مُدخلة: الهوامش الافتراضية 14', () => {
    const result = evaluateOutputProfileForm(form({ paper: 'a4' }), CLASSIC);
    expect(result.errors).toEqual([]);
    expect(result.profile?.margins_mm).toEqual({ top: 14, right: 14, bottom: 14, left: 14 });
    expect(result.profile?.paper).toBe('a4');
  });

  it('A4 أفقي يُطبَّع إلى a4_landscape', () => {
    const result = evaluateOutputProfileForm(form({ paper: 'a4', orientation: 'landscape' }), CLASSIC);
    expect(result.profile?.paper).toBe('a4_landscape');
  });

  it('أخطاء الحقول المفردة: نص، كسر، خارج المدى، فارغ', () => {
    const base = form({ paper: 'a4', marginsTouched: true, margins: { top: '14', right: '14', bottom: '14', left: '14' } });
    expect(evaluateOutputProfileForm({ ...base, margins: { ...base.margins, top: '10mm' } }, CLASSIC).errors).toEqual([{ field: 'top', code: 'margin_invalid' }]);
    expect(evaluateOutputProfileForm({ ...base, margins: { ...base.margins, left: '5.5' } }, CLASSIC).errors[0]).toMatchObject({ field: 'left', code: 'margin_invalid' });
    expect(evaluateOutputProfileForm({ ...base, margins: { ...base.margins, right: '-1' } }, CLASSIC).errors[0]).toMatchObject({ field: 'right', code: 'margin_out_of_range', params: { min: 0, max: 50 } });
    expect(evaluateOutputProfileForm({ ...base, margins: { ...base.margins, bottom: '51' } }, CLASSIC).errors[0]).toMatchObject({ field: 'bottom', code: 'margin_out_of_range' });
    expect(evaluateOutputProfileForm({ ...base, margins: { ...base.margins, top: '' } }, CLASSIC).errors[0]).toMatchObject({ field: 'top', code: 'margin_invalid' });
  });

  it('هوامش كبيرة تُضيّق المحتوى عن حدّ القالب: خطأ نموذج مع الحد الأدنى', () => {
    const result = evaluateOutputProfileForm(form({ paper: 'a4', marginsTouched: true, margins: { top: '20', right: '20', bottom: '20', left: '20' } }), CLASSIC);
    expect(result.profile).toBeNull();
    expect(result.errors).toEqual([{ field: 'form', code: 'content_too_narrow', params: { min: 182 } }]);
  });

  it('A5 عمودي: مقبول لـclassic-v2 ومرفوض لـclassic', () => {
    expect(evaluateOutputProfileForm(form({ paper: 'a5' }), CLASSIC_V2).profile?.paper).toBe('a5');
    expect(evaluateOutputProfileForm(form({ paper: 'a5' }), CLASSIC).errors[0]).toMatchObject({ field: 'paper', code: 'paper_not_supported' });
  });

  it('مخصص: العرض والارتفاع إلزاميان ضمن المدى، والاتجاه مشتق', () => {
    const ok = evaluateOutputProfileForm(form({ paper: 'custom', customWidth: '230', customHeight: '300' }), CLASSIC);
    expect(ok.profile?.custom).toEqual({ width_mm: 230, height_mm: 300 });
    expect(ok.profile?.orientation).toBe('portrait');
    expect(evaluateOutputProfileForm(form({ paper: 'custom', customWidth: '', customHeight: '300' }), CLASSIC).errors[0]).toMatchObject({ field: 'custom_width', code: 'custom_invalid' });
    expect(evaluateOutputProfileForm(form({ paper: 'custom', customWidth: '500', customHeight: '300' }), CLASSIC).errors[0]).toMatchObject({ field: 'custom_width', code: 'custom_out_of_range', params: { min: 40, max: 420 } });
    expect(evaluateOutputProfileForm(form({ paper: 'custom', customWidth: '230', customHeight: '10' }), CLASSIC).errors[0]).toMatchObject({ field: 'custom_height', code: 'custom_out_of_range' });
    expect(evaluateOutputProfileForm(form({ paper: 'custom', customWidth: '230', customHeight: '300' }), 'tax-invoice-thermal80').errors[0]).toMatchObject({ code: 'custom_not_supported' });
  });

  it('لا يُنتج النموذج أبداً ملفاً يرفضه العقد المشترك أو لا يدعمه القالب (فحص عشوائي حتمي)', () => {
    const papers = ['default', 'a4', 'a5', 'a6', 'letter', 'legal', 'custom'] as const;
    const numbers = ['', '0', '5', '10', '14', '20', '50', '51', '-1', '5.5', 'x', '230', '300', '40'];
    let valid = 0;
    for (const paper of papers) for (const orientation of ['portrait', 'landscape'] as const) for (const n of numbers) for (const templateId of [CLASSIC, CLASSIC_V2, ERP_V2, 'tax-invoice-thermal58']) {
      const result = evaluateOutputProfileForm(form({
        paper, orientation, marginsTouched: n !== '', margins: { top: n, right: n, bottom: n, left: n }, customWidth: n, customHeight: n,
      }), templateId);
      if (result.profile) {
        valid += 1;
        expect(normalizeOutputProfile(result.profile)).toEqual({ ok: true, profile: result.profile });
      } else if (!result.clear) {
        expect(result.errors.length, `${paper}/${orientation}/${n}/${templateId}`).toBeGreaterThan(0);
      }
    }
    expect(valid).toBeGreaterThan(20);
  });
});

describe('formFromProfile / formWithPaper', () => {
  it('جولة كاملة: ملف مخزَّن ← نموذج ← الملف نفسه', () => {
    const stored = normalizeOutputProfile({ paper: 'a5', orientation: 'landscape', margins_mm: { top: 12, right: 10, bottom: 10, left: 10 } });
    if (!stored.ok) throw new Error('x');
    const f = formFromProfile(stored.profile);
    expect(f).toMatchObject({ paper: 'a5', orientation: 'landscape', marginsTouched: true });
    expect(evaluateOutputProfileForm(f, CLASSIC).profile).toEqual(stored.profile);
  });

  it('الملف بهوامشه الافتراضية لا يُعدّ «معدَّلاً»', () => {
    const stored = normalizeOutputProfile({ paper: 'a4' });
    if (!stored.ok) throw new Error('x');
    expect(formFromProfile(stored.profile).marginsTouched).toBe(false);
  });

  it('تغيير المقاس يُعيد الهوامش لافتراضيه ويختار اتجاهاً مدعوماً', () => {
    const touched = form({ paper: 'a4', marginsTouched: true, margins: { top: '30', right: '30', bottom: '30', left: '30' } });
    const next = formWithPaper(touched, 'a5', CLASSIC);
    expect(next).toMatchObject({ paper: 'a5', orientation: 'landscape', marginsTouched: false });
    expect(next.margins.top).toBe('10');
    expect(formWithPaper(touched, 'letter', CLASSIC).orientation).toBe('portrait');
  });

  it('ملف رول مخزَّن يظهر كـ«افتراضي» (الحراري لا يُحرَّر من النموذج)', () => {
    const roll = normalizeOutputProfile({ paper: 'thermal_80' });
    if (!roll.ok) throw new Error('x');
    expect(formFromProfile(roll.profile).paper).toBe('default');
  });
});

describe('outputProfileUnwiredTypes', () => {
  it('أنواع تقرؤها صفحاتها اليوم: فاتورة/مبسطة/عرض سعر/إشعارات/أمر شراء', () => {
    expect(outputProfileUnwiredTypes(['tax_invoice', 'simplified_tax_invoice', 'quotation', 'credit_note', 'debit_note', 'purchase_order'])).toEqual([]);
  });
  it('غيرها غير مربوط بعد ويُعلَن', () => {
    expect(outputProfileUnwiredTypes(['tax_invoice', 'receipt_voucher', 'purchase_invoice'])).toEqual(['receipt_voucher', 'purchase_invoice']);
  });
});

describe('outputProfileAfterTemplateChange — التبديل إلى قالب حراري لا يترك ملفاً غير قابل للحفظ', () => {
  it('يُسقط ملف الصفحة غير المطابق عند التبديل إلى حراري (الخلفية سترفضه)', () => {
    expect(outputProfileAfterTemplateChange({ paper: 'a5' }, 'tax-invoice-thermal80')).toBeUndefined();
    expect(outputProfileAfterTemplateChange({ paper: 'a4', orientation: 'landscape' }, 'tax-invoice-thermal58')).toBeUndefined();
    // حراري بعرض آخر ≠ عرض القالب الهدف
    expect(outputProfileAfterTemplateChange({ paper: 'thermal_58' }, 'tax-invoice-thermal80')).toBeUndefined();
  });

  it('يُبقي الملف المطابق لعرض القالب الحراري كما هو', () => {
    const raw = { paper: 'thermal_80' };
    expect(outputProfileAfterTemplateChange(raw, 'tax-invoice-thermal80')).toBe(raw);
  });

  it('لا يمسّ التبديل بين قوالب الصفحات (التحذير وعناصر المسح في المحرر تتولّى الباقي)', () => {
    const raw = { paper: 'a5', orientation: 'landscape' };
    expect(outputProfileAfterTemplateChange(raw, CLASSIC)).toBe(raw);
    expect(outputProfileAfterTemplateChange(raw, CLASSIC_V2)).toBe(raw);
  });

  it('الغياب يبقى غياباً', () => {
    expect(outputProfileAfterTemplateChange(undefined, 'tax-invoice-thermal80')).toBeUndefined();
    expect(outputProfileAfterTemplateChange(null, CLASSIC)).toBeUndefined();
  });
});
