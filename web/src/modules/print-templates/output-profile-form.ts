import { getTemplate } from '@/modules/documents/registry/templates';
import type { DocumentTypeId, PaperSizeId } from '@/modules/documents/types';
import { outputProfileFit } from '@/modules/documents/services/output-spec';
import {
  CUSTOM_HEIGHT_MM,
  CUSTOM_WIDTH_MM,
  DEFAULT_MARGIN_MM,
  CUSTOM_DEFAULT_MARGIN_PAGE_MM,
  MARGIN_MM,
  normalizeOutputProfile,
  readOutputProfile,
  type MarginSide,
  type OutputOrientation,
  type OutputProfile,
} from './services/output-profile';

/**
 * منطق نموذج «إعداد الصفحة» في محرر القوالب (AWJ-DOC-V2-PR3B) — نقيّ بلا React.
 *
 * يبني مدخل Output Profile من قيم الحقول ثم يمرّره **على العقد نفسه** (`normalizeOutputProfile`)
 * وعلى قاعدة دعم القالب نفسها (`outputProfileFit`) التي تستعملها الطباعة وPDF؛ فلا يُحفظ من المحرر
 * ما لا يقبله الخادم أو ما لا يدعمه القالب. السلطة النهائية للخادم عند الحفظ والنشر.
 */

export type FormPaper = 'default' | 'a4' | 'a5' | 'a6' | 'letter' | 'legal' | 'custom';

export const FORM_PAPERS: readonly Exclude<FormPaper, 'default' | 'custom'>[] = ['a4', 'a5', 'a6', 'letter', 'legal'];

/**
 * أنواع المستندات التي تقرأ صفحاتُها ملفَّ الإخراج فعلاً اليوم (فاتورة، عرض سعر، إشعار دائن/مدين،
 * أمر شراء، وبعد AWJ-DOC-V2-PR4: فاتورة المشتريات وسندا القبض والصرف). غيرها (أمر البيع، مذكرة
 * التسليم، كشف الحساب…) لا يقرؤه مساره بعد: يبقى الملف المخزَّن محفوظاً ولا يُعدَّل من المحرر ولا يُعلَن له أثر.
 */
export const OUTPUT_PROFILE_DOCUMENT_TYPES: readonly DocumentTypeId[] = [
  'tax_invoice',
  'simplified_tax_invoice',
  'quotation',
  'credit_note',
  'debit_note',
  'purchase_order',
  'purchase_invoice',
  'receipt_voucher',
  'payment_voucher',
];

export function outputProfileUnwiredTypes(documentTypes: readonly DocumentTypeId[]): DocumentTypeId[] {
  return documentTypes.filter((type) => !OUTPUT_PROFILE_DOCUMENT_TYPES.includes(type));
}

export interface OutputProfileForm {
  paper: FormPaper;
  orientation: OutputOrientation;
  margins: Record<MarginSide, string>;
  /** `false` ⇒ تُرسَل الهوامش الافتراضية للمقاس (لا تُرسَل قيم الحقول). */
  marginsTouched: boolean;
  customWidth: string;
  customHeight: string;
}

export type FormErrorField = 'paper' | 'orientation' | MarginSide | 'custom_width' | 'custom_height' | 'form';

export interface FormError {
  field: FormErrorField;
  /** رمز ثابت يُترجَم في الواجهة. */
  code: string;
  params?: { min?: number; max?: number };
}

export interface PaperChoices {
  /** `thermal`: القالب حراري، مقاسه من القالب ولا اختيار. */
  thermal: Extract<PaperSizeId, 'thermal_58' | 'thermal_80'> | null;
  papers: Array<{ id: Exclude<FormPaper, 'default' | 'custom'>; orientations: OutputOrientation[] }>;
  custom: boolean;
}

/** المقاسات/الاتجاهات التي يعلن القالب دعمها (من `supportedPaper`، لا من تخمين). */
export function paperChoicesForTemplate(templateId: string | null | undefined): PaperChoices {
  const template = getTemplate(templateId);
  const thermal = template.supportedPaper.find((id): id is 'thermal_58' | 'thermal_80' => id === 'thermal_58' || id === 'thermal_80') ?? null;
  if (thermal) return { thermal, papers: [], custom: false };

  const papers = FORM_PAPERS.flatMap((id) => {
    const orientations: OutputOrientation[] = [];
    if (template.supportedPaper.includes(id)) orientations.push('portrait');
    if (template.supportedPaper.includes(`${id}_landscape` as PaperSizeId)) orientations.push('landscape');
    return orientations.length ? [{ id, orientations }] : [];
  });

  return { thermal: null, papers, custom: template.minContentWidthMm !== undefined };
}

/**
 * ما يبقى من `output_profile` الخام بعد تبديل قالب العرض. القالب الحراري يعرض نصاً ثابتاً بلا عناصر تحكم،
 * والخلفية ترفض ملفاً بمقاس لا يطابق عرضه (`thermal_template_paper_mismatch`)؛ فيُسقَط الملف غير المطابق
 * عند التبديل إليه كي لا تبقى مسودة غير قابلة للحفظ بلا وسيلة لإصلاحها. الملف المطابق لعرضه يُبقى؛
 * وغير الحراري يُبقى كما هو (لدى المحرر عندها تحذير وعناصر تحكم للمسح).
 */
export function outputProfileAfterTemplateChange(raw: unknown, templateId: string | null | undefined): unknown {
  if (raw === undefined || raw === null) {
    // AWJ-DOC-V2-PR5: قالب يعلن مقاساً مفضَّلاً (السند المدمج ← A5 أفقي) يُقترح عند اختياره بلا ملف قائم؛
    // ظاهر في «إعداد الصفحة» ويمسحه المستخدم. القوالب الأخرى = غياب كما كان.
    const preferred = getTemplate(templateId).preferredOutput;
    return preferred ? { paper: preferred.paper, orientation: preferred.orientation } : undefined;
  }
  const { thermal } = paperChoicesForTemplate(templateId);
  if (!thermal) return raw;

  const stored = readOutputProfile({ output_profile: raw });
  return stored && stored.paper === thermal ? raw : undefined;
}

export function defaultMarginFor(paper: FormPaper): number {
  return paper === 'default' ? 0 : paper === 'custom' ? CUSTOM_DEFAULT_MARGIN_PAGE_MM : DEFAULT_MARGIN_MM[paper];
}

function marginsOf(value: number): Record<MarginSide, string> {
  const text = String(value);
  return { top: text, right: text, bottom: text, left: text };
}

export function emptyForm(): OutputProfileForm {
  return { paper: 'default', orientation: 'portrait', margins: marginsOf(0), marginsTouched: false, customWidth: '', customHeight: '' };
}

/** يحوّل ملفاً مخزَّناً (مُطبَّعاً) إلى حقول النموذج. */
export function formFromProfile(profile: OutputProfile | null): OutputProfileForm {
  if (!profile) return emptyForm();
  if (profile.output_mode === 'roll') return { ...emptyForm(), paper: 'default' };

  const base = profile.paper === 'custom' ? 'custom' : (profile.paper.replace('_landscape', '') as FormPaper);
  const m = profile.margins_mm;
  const defaults = defaultMarginFor(base);
  const isDefault = m.top === defaults && m.right === defaults && m.bottom === defaults && m.left === defaults;

  return {
    paper: base,
    orientation: profile.orientation,
    margins: { top: String(m.top), right: String(m.right), bottom: String(m.bottom), left: String(m.left) },
    marginsTouched: !isDefault,
    customWidth: profile.custom ? String(profile.custom.width_mm) : '',
    customHeight: profile.custom?.height_mm != null ? String(profile.custom.height_mm) : '',
  };
}

/** تغيير المقاس يُعيد الهوامش إلى افتراضيه والاتجاه إلى أول اتجاه مدعوم. */
export function formWithPaper(form: OutputProfileForm, paper: FormPaper, templateId: string | null | undefined): OutputProfileForm {
  const choices = paperChoicesForTemplate(templateId);
  const supported = choices.papers.find((item) => item.id === paper)?.orientations ?? ['portrait'];
  const orientation = supported.includes(form.orientation) ? form.orientation : supported[0];

  return {
    ...form,
    paper,
    orientation,
    margins: marginsOf(defaultMarginFor(paper)),
    marginsTouched: false,
  };
}

const SIDES: readonly MarginSide[] = ['top', 'right', 'bottom', 'left'];

function parseInteger(text: string): number {
  return text.trim() === '' ? Number.NaN : Number(text);
}

export interface FormEvaluation {
  /** الملف الصالح والمدعوم من القالب، أو `null`. */
  profile: OutputProfile | null;
  /** `true` حين يعني النموذج «افتراضي القالب» (لا ملف). */
  clear: boolean;
  errors: FormError[];
}

export function evaluateOutputProfileForm(form: OutputProfileForm, templateId: string | null | undefined): FormEvaluation {
  if (form.paper === 'default') return { profile: null, clear: true, errors: [] };

  const errors: FormError[] = [];

  // تحقق الحقول المفردة أولاً (رسائل مفهومة لكل حقل)، ثم العقد المشترك للتحققات المتقاطعة.
  if (form.marginsTouched) {
    for (const side of SIDES) {
      const value = parseInteger(form.margins[side]);
      if (!Number.isInteger(value)) errors.push({ field: side, code: 'margin_invalid' });
      else if (value < MARGIN_MM[0] || value > MARGIN_MM[1]) errors.push({ field: side, code: 'margin_out_of_range', params: { min: MARGIN_MM[0], max: MARGIN_MM[1] } });
    }
  }

  const input: Record<string, unknown> = { paper: form.paper, orientation: form.orientation };
  if (form.paper === 'custom') {
    const width = parseInteger(form.customWidth);
    const height = parseInteger(form.customHeight);
    if (!Number.isInteger(width)) errors.push({ field: 'custom_width', code: 'custom_invalid' });
    else if (width < CUSTOM_WIDTH_MM[0] || width > CUSTOM_WIDTH_MM[1]) errors.push({ field: 'custom_width', code: 'custom_out_of_range', params: { min: CUSTOM_WIDTH_MM[0], max: CUSTOM_WIDTH_MM[1] } });
    if (!Number.isInteger(height)) errors.push({ field: 'custom_height', code: 'custom_invalid' });
    else if (height < CUSTOM_HEIGHT_MM[0] || height > CUSTOM_HEIGHT_MM[1]) errors.push({ field: 'custom_height', code: 'custom_out_of_range', params: { min: CUSTOM_HEIGHT_MM[0], max: CUSTOM_HEIGHT_MM[1] } });
    input.custom = { width_mm: width, height_mm: height };
    // الاتجاه للمخصص يُشتق من الأبعاد.
    delete input.orientation;
  }
  if (form.marginsTouched) {
    input.margins_mm = Object.fromEntries(SIDES.map((side) => [side, parseInteger(form.margins[side])]));
  }
  if (errors.length) return { profile: null, clear: false, errors };

  const result = normalizeOutputProfile(input);
  if (!result.ok) {
    const field: FormErrorField = result.reason === 'printable_area_too_small' ? 'form' : result.reason.startsWith('orientation') ? 'orientation' : 'paper';
    return { profile: null, clear: false, errors: [{ field, code: result.reason }] };
  }

  const fit = outputProfileFit(result.profile, templateId);
  if (!fit.supported) {
    return {
      profile: null,
      clear: false,
      errors: [{ field: fit.reason === 'content_too_narrow' ? 'form' : 'paper', code: fit.reason, params: fit.minContentWidthMm ? { min: fit.minContentWidthMm } : undefined }],
    };
  }

  return { profile: result.profile, clear: false, errors: [] };
}
