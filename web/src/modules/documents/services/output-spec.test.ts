import { describe, expect, it } from 'vitest';
import { PAPER_SIZES } from '@/modules/documents/constants/paper';
import { getTemplate, listTemplates } from '@/modules/documents/registry/templates';
import { normalizeOutputProfile, type OutputProfile } from '@/modules/print-templates/services/output-profile';
import { outputProfileFit, resolveDocumentOutputSpec } from './output-spec';

function profile(input: Record<string, unknown>): OutputProfile {
  const result = normalizeOutputProfile(input);
  if (!result.ok) throw new Error(`invalid test profile: ${result.reason}`);
  return result.profile;
}

/**
 * جدول الدعم المعلَن = ما أثبته قياس Chromium (e2e/output-profile-fidelity.spec.ts) ومراجعة بصرية.
 * أي توسيع لقالب (مقاس جديد أو عرض أضيق) يتطلب تحديث هذا الجدول **وبدليل** — هذا الاختبار يمنع
 * الإعلان الصامت. الأول في القائمة هو الورق الافتراضي بلا ملف إخراج.
 */
const DECLARED: Record<string, { extra: string[]; minContentWidthMm: number }> = {
  'tax-invoice-classic': { extra: ['a4_landscape', 'a5_landscape'], minContentWidthMm: 182 },
  'tax-invoice-classic-v2': { extra: ['a4_landscape', 'a5_landscape', 'a5', 'a6_landscape'], minContentWidthMm: 128 },
  'tax-invoice-modern': { extra: ['a4_landscape', 'a5_landscape'], minContentWidthMm: 182 },
  'tax-invoice-modern-v2': { extra: ['a4_landscape', 'a5_landscape'], minContentWidthMm: 182 },
  'tax-invoice-erp': { extra: ['a4_landscape', 'a5_landscape'], minContentWidthMm: 182 },
  'tax-invoice-erp-v2': { extra: ['a4_landscape', 'a5_landscape', 'a6_landscape'], minContentWidthMm: 132 },
  'tax-invoice-minimal': { extra: ['a4_landscape', 'a5_landscape', 'a6_landscape'], minContentWidthMm: 132 },
  'tax-invoice-minimal-v2': { extra: ['a4_landscape', 'a5_landscape', 'a6_landscape'], minContentWidthMm: 132 },
  'tax-invoice-retail': { extra: ['a4_landscape', 'a5_landscape'], minContentWidthMm: 182 },
  'tax-invoice-retail-v2': { extra: ['a4_landscape', 'a5_landscape'], minContentWidthMm: 182 },
  'quotation-proposal': { extra: ['a5_landscape'], minContentWidthMm: 182 },
  'purchase-order-formal': { extra: ['a5_landscape'], minContentWidthMm: 182 },
  // AWJ-DOC-V2-PR5: السند المدمج — قيس في e2e/voucher-compact-pr5-harness.spec.ts (A6 عمودي وLetter/Legal غير معلنة).
  'voucher-compact': { extra: ['a4_landscape', 'a5_landscape', 'a5', 'a6_landscape'], minContentWidthMm: 128 },
};

describe('الدعم المعلَن للقوالب = الدليل المقاس فقط', () => {
  it('كل قالب صفحات يعلن بالضبط ما في جدول الأدلة، والحراريان لا يعلنان صفحات', () => {
    for (const template of listTemplates()) {
      if (template.supportedPaper.some((id) => id.startsWith('thermal_'))) {
        expect(template.minContentWidthMm, template.id).toBeUndefined();
        continue;
      }
      const expected = DECLARED[template.id];
      expect(expected, `قالب بلا سجلّ دليل: ${template.id}`).toBeDefined();
      expect(template.minContentWidthMm, template.id).toBe(expected.minContentWidthMm);
      const legacy = template.supportedPaper.filter((id) => !expected.extra.includes(id));
      expect([...legacy, ...expected.extra].sort(), template.id).toEqual([...template.supportedPaper].sort());
    }
  });

  it('A6 العمودي غير معلَن لأي قالب (يحتاج إعادة تصميم جدول الأطراف — موثَّق، لا يُعلَن)', () => {
    for (const template of listTemplates()) expect(template.supportedPaper, template.id).not.toContain('a6');
  });

  it('A5 العمودي معلَن لـclassic-v2 والسند المدمج وحدهما', () => {
    const owners = listTemplates().filter((template) => template.supportedPaper.includes('a5')).map((template) => template.id);
    expect(owners).toEqual(['tax-invoice-classic-v2', 'voucher-compact']);
  });
});

describe('resolveDocumentOutputSpec — غياب الملف = السلوك السابق حرفياً', () => {
  it('بلا ملف: الورق من supportedPaper[0] وبلا إطار ولا هوامش، لكل القوالب', () => {
    for (const template of listTemplates()) {
      const first = PAPER_SIZES[template.supportedPaper[0]];
      for (const absent of [null, undefined]) {
        const spec = resolveDocumentOutputSpec(template.id, absent);
        expect(spec.profile, template.id).toBeNull();
        expect(spec.frame, template.id).toBeNull();
        expect(spec.paper, template.id).toEqual({ widthMm: first.widthMm, heightMm: first.heightMm });
        expect(spec.paper, template.id).not.toHaveProperty('marginsMm');
      }
    }
  });

  it('قالب غير معروف يسقط إلى القالب الافتراضي كما في السجل (لا استثناء)', () => {
    const spec = resolveDocumentOutputSpec('does-not-exist', null);
    expect(spec.paper).toEqual({ widthMm: 210, heightMm: 297 });
  });
});

describe('resolveDocumentOutputSpec — ملف مدعوم', () => {
  it('A5 أفقي لـclassic: الورقة 210×148، الهوامش الافتراضية 10، المحتوى 190×128', () => {
    const spec = resolveDocumentOutputSpec('tax-invoice-classic', profile({ paper: 'a5', orientation: 'landscape' }));
    expect(spec.paper).toEqual({ widthMm: 210, heightMm: 148, marginsMm: { top: 10, right: 10, bottom: 10, left: 10 } });
    expect(spec.frame).toEqual({
      paperWidthMm: 210, paperHeightMm: 148,
      marginsMm: { top: 10, right: 10, bottom: 10, left: 10 },
      contentWidthMm: 190, contentMinHeightMm: 128,
    });
  });

  it('A5 عمودي لـclassic-v2: محتوى 128 مم (إطار ضيّق)', () => {
    const spec = resolveDocumentOutputSpec('tax-invoice-classic-v2', profile({ paper: 'a5' }));
    expect(spec.frame?.contentWidthMm).toBe(128);
    expect(spec.paper.marginsMm).toEqual({ top: 10, right: 10, bottom: 10, left: 10 });
  });

  it('هوامش صريحة تُنقل كما هي إلى الورق والإطار', () => {
    const spec = resolveDocumentOutputSpec('tax-invoice-classic', profile({ paper: 'a4', margins_mm: { top: 5, right: 6, bottom: 7, left: 8 } }));
    expect(spec.paper.marginsMm).toEqual({ top: 5, right: 6, bottom: 7, left: 8 });
    expect(spec.frame?.contentWidthMm).toBe(210 - 6 - 8);
    expect(spec.frame?.contentMinHeightMm).toBe(297 - 5 - 7);
  });

  it('Letter/Legal ومخصص بعرض محتوى كافٍ', () => {
    expect(resolveDocumentOutputSpec('tax-invoice-classic', profile({ paper: 'letter' })).frame?.contentWidthMm).toBe(188);
    expect(resolveDocumentOutputSpec('tax-invoice-classic', profile({ paper: 'legal' })).paper.heightMm).toBe(356);
    const custom = resolveDocumentOutputSpec('tax-invoice-classic', profile({ paper: 'custom', custom: { width_mm: 230, height_mm: 300 } }));
    expect(custom.paper).toMatchObject({ widthMm: 230, heightMm: 300 });
    expect(custom.frame?.contentWidthMm).toBe(210);
  });

  it('الحراري: رول بمقاس القالب، بلا إطار ولا هوامش', () => {
    const spec = resolveDocumentOutputSpec('tax-invoice-thermal80', profile({ paper: 'thermal_80' }));
    expect(spec.paper).toEqual({ widthMm: 80, heightMm: 0 });
    expect(spec.frame).toBeNull();
    expect(spec.profile?.paper).toBe('thermal_80');
  });
});

describe('resolveDocumentOutputSpec — ملف غير مدعوم من القالب يُعامل كغائب (فشل آمن)', () => {
  const legacy = (id: string) => resolveDocumentOutputSpec(id, null);

  it.each([
    ['A6 عمودي على classic-v2', 'tax-invoice-classic-v2', { paper: 'a6' }],
    ['A5 عمودي على classic', 'tax-invoice-classic', { paper: 'a5' }],
    ['A6 أفقي على classic', 'tax-invoice-classic', { paper: 'a6', orientation: 'landscape' }],
    ['A4 بهوامش 20 على classic (محتوى 170 < 182)', 'tax-invoice-classic', { paper: 'a4', margins_mm: { top: 20, right: 20, bottom: 20, left: 20 } }],
    ['مخصص أضيق من الحد', 'tax-invoice-classic-v2', { paper: 'custom', custom: { width_mm: 130, height_mm: 200 } }],
    ['مخصص رول على قالب صفحات', 'tax-invoice-classic', { paper: 'custom', custom: { width_mm: 72 } }],
    ['حراري 58 على قالب 80', 'tax-invoice-thermal80', { paper: 'thermal_58' }],
    ['A4 على قالب حراري', 'tax-invoice-thermal58', { paper: 'a4' }],
    ['رول حراري على قالب صفحات', 'tax-invoice-classic', { paper: 'thermal_80' }],
  ])('%s', (_label, templateId, input) => {
    const spec = resolveDocumentOutputSpec(templateId, profile(input));
    expect(spec).toEqual(legacy(templateId));
  });

  it('أسباب الرفض مسمّاة', () => {
    expect(outputProfileFit(profile({ paper: 'a6' }), 'tax-invoice-classic-v2')).toEqual({ supported: false, reason: 'paper_not_supported' });
    expect(outputProfileFit(profile({ paper: 'a4', margins_mm: { top: 20, right: 20, bottom: 20, left: 20 } }), 'tax-invoice-classic'))
      .toEqual({ supported: false, reason: 'content_too_narrow', minContentWidthMm: 182 });
    expect(outputProfileFit(profile({ paper: 'custom', custom: { width_mm: 72 } }), 'tax-invoice-classic'))
      .toEqual({ supported: false, reason: 'roll_not_supported' });
    expect(outputProfileFit(profile({ paper: 'custom', custom: { width_mm: 200, height_mm: 200 } }), 'tax-invoice-thermal80'))
      .toEqual({ supported: false, reason: 'custom_not_supported' });
  });

  it('الهوامش الكبيرة تُسقط الدعم حتى لمقاس معلَن، والصغيرة تحفظه', () => {
    expect(outputProfileFit(profile({ paper: 'a5', margins_mm: { top: 10, right: 10, bottom: 10, left: 10 } }), 'tax-invoice-classic-v2').supported).toBe(true);
    expect(outputProfileFit(profile({ paper: 'a5', margins_mm: { top: 10, right: 11, bottom: 10, left: 10 } }), 'tax-invoice-classic-v2').supported).toBe(false);
  });
});

describe('getTemplate يبقى كما هو', () => {
  it('الورق الافتراضي A4 لقوالب الصفحات الاثني عشر', () => {
    for (const id of Object.keys(DECLARED)) expect(getTemplate(id).supportedPaper[0], id).toBe('a4');
  });
});
