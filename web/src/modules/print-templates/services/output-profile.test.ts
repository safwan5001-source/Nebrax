import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PAPER_SIZES } from '@/modules/documents/constants/paper';
import { getTemplate, listTemplates } from '@/modules/documents/registry/templates';
import { resolveTemplateRevisionDefinition } from './live-template-definition';
import {
  CUSTOM_DEFAULT_MARGIN_PAGE_MM,
  CUSTOM_DEFAULT_MARGIN_ROLL_MM,
  CUSTOM_HEIGHT_MM,
  CUSTOM_PAPER_ID,
  CUSTOM_WIDTH_MM,
  DEFAULT_MARGIN_MM,
  MARGIN_MM,
  MIN_PRINTABLE_MM,
  OUTPUT_PROFILE_VERSION,
  THERMAL_TEMPLATE_PAPERS,
  normalizeOutputProfile,
  outputProfilePaper,
  preserveOutputProfile,
  readOutputProfile,
} from './output-profile';

interface Fixture {
  version: number;
  papers: Record<string, { width_mm: number; height_mm: number | null; orientation: string; output_mode: string; default_margin_mm: number }>;
  custom_paper_id: string;
  limits: Record<string, number | number[]>;
  thermal_template_papers: Record<string, string>;
  reasons: string[];
  valid: Array<{ name: string; input: unknown; normalized: unknown }>;
  invalid: Array<{ name: string; input: unknown; reason: string }>;
}

// العقد المشترك مع الخلفية (PrintOutputProfileContractTest تحاكمه بالمثل).
const fixture = JSON.parse(
  readFileSync(resolve(process.cwd(), '../contracts/print-templates/output-profile.v1.json'), 'utf8'),
) as Fixture;

describe('Output Profile — shared contract parity', () => {
  it('constants match the shared contract file', () => {
    expect(OUTPUT_PROFILE_VERSION).toBe(fixture.version);
    expect(CUSTOM_PAPER_ID).toBe(fixture.custom_paper_id);
    expect([...CUSTOM_WIDTH_MM]).toEqual(fixture.limits.custom_width_mm);
    expect([...CUSTOM_HEIGHT_MM]).toEqual(fixture.limits.custom_height_mm);
    expect([...MARGIN_MM]).toEqual(fixture.limits.margin_mm);
    expect(MIN_PRINTABLE_MM).toBe(fixture.limits.min_printable_mm);
    expect(CUSTOM_DEFAULT_MARGIN_PAGE_MM).toBe(fixture.limits.custom_default_margin_mm_page);
    expect(CUSTOM_DEFAULT_MARGIN_ROLL_MM).toBe(fixture.limits.custom_default_margin_mm_roll);
    expect(THERMAL_TEMPLATE_PAPERS).toEqual(fixture.thermal_template_papers);
  });

  it('PAPER_SIZES carries exactly the contract papers with the same dimensions and defaults', () => {
    expect(Object.keys(PAPER_SIZES).sort()).toEqual(Object.keys(fixture.papers).sort());
    expect(Object.keys(DEFAULT_MARGIN_MM).sort()).toEqual(Object.keys(fixture.papers).sort());

    for (const [id, spec] of Object.entries(fixture.papers)) {
      const size = PAPER_SIZES[id as keyof typeof PAPER_SIZES];
      expect(size.widthMm, id).toBe(spec.width_mm);
      expect(size.heightMm, id).toBe(spec.height_mm ?? 0);
      expect(size.orientation, id).toBe(spec.orientation);
      expect((size.heightMm > 0 ? 'page' : 'roll'), id).toBe(spec.output_mode);
      expect(DEFAULT_MARGIN_MM[id as keyof typeof DEFAULT_MARGIN_MM], id).toBe(spec.default_margin_mm);
    }
  });

  it.each(fixture.valid.map((c) => [c.name, c] as const))('valid: %s', (_name, c) => {
    const result = normalizeOutputProfile(c.input);
    expect(result).toEqual({ ok: true, profile: c.normalized });

    // الصيغة المُطبَّعة تُقبل من جديد وتعود كما هي (النشر يعيد التحقق من المخزَّن).
    expect(normalizeOutputProfile(c.normalized)).toEqual({ ok: true, profile: c.normalized });
  });

  it.each(fixture.invalid.map((c) => [c.name, c] as const))('invalid: %s', (_name, c) => {
    expect(fixture.reasons).toContain(c.reason);
    expect(normalizeOutputProfile(c.input)).toEqual({ ok: false, reason: c.reason });
  });
});

describe('legacy paper ids are preserved byte for byte', () => {
  it('keeps the pre-existing ids and dimensions unchanged', () => {
    const legacy = {
      a4: [210, 297], a4_landscape: [297, 210], letter: [216, 279], legal: [216, 356], thermal_58: [58, 0], thermal_80: [80, 0],
    } as const;
    for (const [id, [w, h]] of Object.entries(legacy)) {
      const size = PAPER_SIZES[id as keyof typeof PAPER_SIZES];
      expect([size.widthMm, size.heightMm], id).toEqual([w, h]);
    }
  });

  it('adds A5/A6 as new ids without touching the existing ones', () => {
    expect([PAPER_SIZES.a5.widthMm, PAPER_SIZES.a5.heightMm]).toEqual([148, 210]);
    expect([PAPER_SIZES.a5_landscape.widthMm, PAPER_SIZES.a5_landscape.heightMm]).toEqual([210, 148]);
    expect([PAPER_SIZES.a6.widthMm, PAPER_SIZES.a6.heightMm]).toEqual([105, 148]);
    expect([PAPER_SIZES.a6_landscape.widthMm, PAPER_SIZES.a6_landscape.heightMm]).toEqual([148, 105]);
  });

  it('only appends to supportedPaper: the first (default) paper of every template is unchanged', () => {
    // الورق الافتراضي للمستند بلا ملف إخراج = `supportedPaper[0]`؛ PR3-B يُلحق فقط ولا يعيد ترتيباً.
    const firstPaper: Record<string, string> = {
      'tax-invoice-classic': 'a4', 'tax-invoice-classic-v2': 'a4', 'tax-invoice-modern': 'a4', 'tax-invoice-modern-v2': 'a4',
      'tax-invoice-erp': 'a4', 'tax-invoice-erp-v2': 'a4', 'tax-invoice-minimal': 'a4', 'tax-invoice-minimal-v2': 'a4',
      'tax-invoice-retail': 'a4', 'tax-invoice-retail-v2': 'a4', 'quotation-proposal': 'a4', 'purchase-order-formal': 'a4',
      'tax-invoice-thermal58': 'thermal_58', 'tax-invoice-thermal80': 'thermal_80',
    };
    for (const template of listTemplates()) {
      expect(template.supportedPaper[0], template.id).toBe(firstPaper[template.id]);
    }
    expect(getTemplate('tax-invoice-thermal58').supportedPaper).toEqual(['thermal_58']);
  });

  it('registered thermal templates map to the width the contract requires', () => {
    for (const [templateId, paper] of Object.entries(THERMAL_TEMPLATE_PAPERS)) {
      expect(getTemplate(templateId).supportedPaper, templateId).toEqual([paper]);
    }
  });
});

describe('readOutputProfile — absence preserves legacy behaviour', () => {
  it('returns null for definitions without a profile', () => {
    expect(readOutputProfile(undefined)).toBeNull();
    expect(readOutputProfile(null)).toBeNull();
    expect(readOutputProfile('x')).toBeNull();
    expect(readOutputProfile([])).toBeNull();
    expect(readOutputProfile({})).toBeNull();
    expect(readOutputProfile({ template_id: 'tax-invoice-classic' })).toBeNull();
    expect(readOutputProfile({ template_id: 'tax-invoice-classic', output_profile: null })).toBeNull();
  });

  it('fails safe to legacy (null) on an invalid stored profile instead of guessing a size', () => {
    expect(readOutputProfile({ output_profile: { paper: 'a3' } })).toBeNull();
    expect(readOutputProfile({ output_profile: { paper: 'a4', css: 'x' } })).toBeNull();
  });

  it('reads a valid stored profile', () => {
    const profile = readOutputProfile({ output_profile: { paper: 'a5', orientation: 'landscape' } });
    expect(profile?.paper).toBe('a5_landscape');
    expect(profile?.margins_mm).toEqual({ top: 10, right: 10, bottom: 10, left: 10 });
  });

  it('a revision whose definition holds only an output profile is still a current definition (default template + stored profile)', () => {
    const resolved = resolveTemplateRevisionDefinition(
      { id: 'r', definition: { output_profile: { paper: 'a4', orientation: 'landscape' } } },
      'tax_invoice',
    );
    expect(resolved).not.toBeNull();
    expect(resolved?.outputProfile?.paper).toBe('a4_landscape');
    // التعريف القديم بلا أي مفتاح حديث يبقى غير معروف.
    expect(resolveTemplateRevisionDefinition({ id: 'r', definition: { legacy_sales_designs: [] } }, 'tax_invoice')).toBeNull();
  });

  it('does not change how a revision definition resolves for the document renderer', () => {
    const base = { template_id: 'tax-invoice-classic', theme_id: 'blue', footer_text: 'تذييل' };
    const without = resolveTemplateRevisionDefinition({ id: 'r', definition: base }, 'tax_invoice');
    const withProfile = resolveTemplateRevisionDefinition(
      { id: 'r', definition: { ...base, output_profile: { paper: 'a5', orientation: 'landscape' } } },
      'tax_invoice',
    );
    // العرض (المعرّف/الثيم/التخطيط/النصوص) لا يتغيّر؛ الجديد حقل `outputProfile` وحده.
    expect({ ...withProfile, outputProfile: null }).toEqual(without);
    expect(without?.outputProfile).toBeNull();
    expect(withProfile?.outputProfile?.paper).toBe('a5_landscape');
  });
});

describe('outputProfilePaper', () => {
  const paperOf = (input: unknown) => {
    const result = normalizeOutputProfile(input);
    if (!result.ok) throw new Error(result.reason);
    return outputProfilePaper(result.profile);
  };

  it('resolves fixed, landscape, roll and custom papers to the PdfPaper convention (height 0 = roll)', () => {
    expect(paperOf({ paper: 'a4' })).toEqual({ widthMm: 210, heightMm: 297 });
    expect(paperOf({ paper: 'a6', orientation: 'landscape' })).toEqual({ widthMm: 148, heightMm: 105 });
    expect(paperOf({ paper: 'thermal_80' })).toEqual({ widthMm: 80, heightMm: 0 });
    expect(paperOf({ paper: 'custom', custom: { width_mm: 100, height_mm: 150 } })).toEqual({ widthMm: 100, heightMm: 150 });
    expect(paperOf({ paper: 'custom', custom: { width_mm: 72 } })).toEqual({ widthMm: 72, heightMm: 0 });
  });
});

describe('preserveOutputProfile — the editor must not drop a profile it does not edit', () => {
  it('carries a raw profile through and is a no-op when absent', () => {
    expect(preserveOutputProfile({ output_profile: { paper: 'a5' } })).toEqual({ output_profile: { paper: 'a5' } });
    expect(preserveOutputProfile({ template_id: 'x' })).toEqual({});
    expect(preserveOutputProfile({ output_profile: null })).toEqual({});
    expect(preserveOutputProfile(undefined)).toEqual({});
  });

  it('the Studio keeps every definition key on save', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/modules/print-templates/template-definition.ts'),
      'utf8',
    );
    // PR3-B: لا يُسقط الحفظ أي مفتاح (بما فيه output_profile) — يُنشر التعريف القائم كاملاً ثم تُكتب الحقول المعروفة.
    expect(source).toMatch(/\.\.\.definition,\s*\n\s*template_id:/);
  });
});
