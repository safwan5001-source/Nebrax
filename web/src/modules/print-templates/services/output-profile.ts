import { PAPER_SIZES } from '@/modules/documents/constants/paper';
import type { PaperSizeId } from '@/modules/documents/types';

/**
 * AWJ Output Profile v1 — مرآة الواجهة لـ`App\Support\PrintOutputProfile`.
 *
 * يُخزَّن اختيارياً في `definition.output_profile` لمراجعة قالب الطباعة؛ لا جدول
 * ولا إعدادات موازية. **الغياب = السلوك القديم حرفياً**: `readOutputProfile` يعيد
 * `null` ولا يفرض شيئاً على قالب بلا ملف، ولا يعيد حل قالب منشور أو مرحَّل.
 *
 * الخادم هو السلطة الوحيدة عند الحفظ والنشر؛ هذه الوحدة للمعاينة والتحقق المسبق
 * ولقراءة ملف مخزَّن. كلا الطرفين يُحاكَم بالملف المشترك
 * `contracts/print-templates/output-profile.v1.json` (انظر `output-profile.test.ts`)،
 * وأي بُعد أو حدّ يتغيّر يستلزم إصداراً جديداً للعقد لا تعديل v1.
 *
 * كل قيمة معرّف من قائمة بيضاء أو عدد صحيح بالمليمتر: لا CSS خام ولا وحدات ولا كسور.
 */

export const OUTPUT_PROFILE_VERSION = 1;
export const OUTPUT_PROFILE_KEY = 'output_profile';

export type OutputProfilePaperId = PaperSizeId | 'custom';
export type OutputOrientation = 'portrait' | 'landscape';
export type OutputMode = 'page' | 'roll';
export type MarginSide = 'top' | 'right' | 'bottom' | 'left';
export type OutputMargins = Record<MarginSide, number>;

export interface OutputProfileCustomSize {
  width_mm: number;
  /** `null` للفة: الارتفاع يُقاس من المحتوى. */
  height_mm: number | null;
}

/** الصيغة القانونية المُطبَّعة (كل الافتراضات مملوءة) كما يخزّنها الخادم. */
export interface OutputProfile {
  version: typeof OUTPUT_PROFILE_VERSION;
  paper: OutputProfilePaperId;
  orientation: OutputOrientation;
  output_mode: OutputMode;
  margins_mm: OutputMargins;
  custom?: OutputProfileCustomSize;
}

export type OutputProfileReason =
  | 'not_an_object' | 'unknown_key' | 'unsupported_version' | 'paper_invalid'
  | 'orientation_invalid' | 'orientation_conflict' | 'orientation_unsupported'
  | 'output_mode_invalid' | 'output_mode_conflict'
  | 'custom_required' | 'custom_not_allowed' | 'custom_invalid' | 'custom_out_of_range'
  | 'margins_invalid' | 'margins_out_of_range' | 'printable_area_too_small';

export type OutputProfileResult =
  | { ok: true; profile: OutputProfile }
  | { ok: false; reason: OutputProfileReason };

export const CUSTOM_PAPER_ID = 'custom';
export const CUSTOM_WIDTH_MM = [40, 420] as const;
export const CUSTOM_HEIGHT_MM = [40, 600] as const;
export const MARGIN_MM = [0, 50] as const;
export const MIN_PRINTABLE_MM = 30;
export const CUSTOM_DEFAULT_MARGIN_PAGE_MM = 10;
export const CUSTOM_DEFAULT_MARGIN_ROLL_MM = 0;

type FixedPaperId = PaperSizeId;

/** هامش افتراضي لكل مقاس ثابت (A4 = 14مم كقاعدة `@page` العامة القائمة). */
export const DEFAULT_MARGIN_MM: Record<FixedPaperId, number> = {
  a4: 14, a4_landscape: 14,
  a5: 10, a5_landscape: 10,
  a6: 8, a6_landscape: 8,
  letter: 14, legal: 14,
  thermal_58: 0, thermal_80: 0,
};

/** عارضا الإيصال الحراري المسجَّلان ومقاس كل منهما (يطابق الخادم). */
export const THERMAL_TEMPLATE_PAPERS: Record<string, FixedPaperId> = {
  'tax-invoice-thermal58': 'thermal_58',
  'tax-invoice-thermal80': 'thermal_80',
};

const PROFILE_KEYS = ['version', 'paper', 'orientation', 'output_mode', 'margins_mm', 'custom'];
const SIDES: MarginSide[] = ['top', 'right', 'bottom', 'left'];
const CUSTOM_KEYS = ['width_mm', 'height_mm'];
const ORIENTATIONS: OutputOrientation[] = ['portrait', 'landscape'];
const MODES: OutputMode[] = ['page', 'roll'];

const fail = (reason: OutputProfileReason): OutputProfileResult => ({ ok: false, reason });
const isObject = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);
const hasOnly = (value: Record<string, unknown>, allowed: readonly string[]) => (
  Object.keys(value).every((key) => allowed.includes(key))
);
const isFixedPaper = (value: string): value is FixedPaperId => (
  Object.prototype.hasOwnProperty.call(DEFAULT_MARGIN_MM, value)
);

function fixedSpec(paper: FixedPaperId) {
  const size = PAPER_SIZES[paper];
  return {
    width: size.widthMm,
    height: size.heightMm > 0 ? size.heightMm : null,
    orientation: size.orientation,
    mode: (size.heightMm > 0 ? 'page' : 'roll') as OutputMode,
  };
}

/**
 * يتحقق من ملف الإخراج ويعيد صيغته المُطبَّعة أو رمز سبب ثابتاً مشتركاً مع الخادم.
 * الصيغة المُطبَّعة تُقبل مدخلاً من جديد وتعود كما هي.
 */
export function normalizeOutputProfile(raw: unknown): OutputProfileResult {
  if (!isObject(raw)) return fail('not_an_object');
  if (!hasOnly(raw, PROFILE_KEYS)) return fail('unknown_key');
  if ('version' in raw && raw.version !== OUTPUT_PROFILE_VERSION) return fail('unsupported_version');

  let paper = raw.paper;
  if (typeof paper !== 'string' || (paper !== CUSTOM_PAPER_ID && !isFixedPaper(paper))) return fail('paper_invalid');

  const orientationIn = raw.orientation ?? null;
  if (orientationIn !== null && !ORIENTATIONS.includes(orientationIn as OutputOrientation)) return fail('orientation_invalid');
  const modeIn = raw.output_mode ?? null;
  if (modeIn !== null && !MODES.includes(modeIn as OutputMode)) return fail('output_mode_invalid');

  let orientation: OutputOrientation;
  let mode: OutputMode;
  let width: number;
  let height: number | null;
  let custom: OutputProfileCustomSize | undefined;

  if (paper === CUSTOM_PAPER_ID) {
    const customIn = raw.custom ?? null;
    if (customIn === null) return fail('custom_required');
    if (!isObject(customIn)) return fail('custom_invalid');
    if (!hasOnly(customIn, CUSTOM_KEYS)) return fail('unknown_key');

    const widthCheck = customDimension(customIn.width_mm, CUSTOM_WIDTH_MM);
    if (widthCheck !== 'ok') return fail(widthCheck);
    width = customIn.width_mm as number;

    const heightRaw = customIn.height_mm ?? null;
    mode = (modeIn as OutputMode | null) ?? (heightRaw === null ? 'roll' : 'page');
    if (mode === 'roll' && heightRaw !== null) return fail('output_mode_conflict');
    height = null;
    if (mode === 'page') {
      const heightCheck = customDimension(heightRaw, CUSTOM_HEIGHT_MM);
      if (heightCheck !== 'ok') return fail(heightCheck);
      height = heightRaw as number;
    }

    orientation = height !== null && width > height ? 'landscape' : 'portrait';
    if (orientationIn !== null && orientationIn !== orientation) return fail('orientation_conflict');
    custom = { width_mm: width, height_mm: height };
  } else {
    if (raw.custom !== undefined && raw.custom !== null) return fail('custom_not_allowed');

    let spec = fixedSpec(paper as FixedPaperId);
    if (orientationIn !== null && orientationIn !== spec.orientation) {
      if (spec.orientation === 'landscape') return fail('orientation_conflict');
      const landscapeId = `${paper}_landscape`;
      if (!isFixedPaper(landscapeId)) return fail('orientation_unsupported');
      paper = landscapeId;
      spec = fixedSpec(landscapeId);
    }
    if (modeIn !== null && modeIn !== spec.mode) return fail('output_mode_conflict');

    orientation = spec.orientation;
    mode = spec.mode;
    width = spec.width;
    height = spec.height;
  }

  const defaultMargin = paper === CUSTOM_PAPER_ID
    ? (mode === 'roll' ? CUSTOM_DEFAULT_MARGIN_ROLL_MM : CUSTOM_DEFAULT_MARGIN_PAGE_MM)
    : DEFAULT_MARGIN_MM[paper as FixedPaperId];
  const margins = resolveMargins(raw.margins_mm ?? null, defaultMargin);
  if (!margins.ok) return fail(margins.reason);

  const m = margins.value;
  if (width - m.left - m.right < MIN_PRINTABLE_MM || (height !== null && height - m.top - m.bottom < MIN_PRINTABLE_MM)) {
    return fail('printable_area_too_small');
  }

  const profile: OutputProfile = {
    version: OUTPUT_PROFILE_VERSION,
    paper: paper as OutputProfilePaperId,
    orientation,
    output_mode: mode,
    margins_mm: m,
  };
  if (custom) profile.custom = custom;

  return { ok: true, profile };
}

function customDimension(value: unknown, range: readonly [number, number]): 'ok' | 'custom_invalid' | 'custom_out_of_range' {
  if (typeof value !== 'number' || !Number.isInteger(value)) return 'custom_invalid';
  return value < range[0] || value > range[1] ? 'custom_out_of_range' : 'ok';
}

function resolveMargins(
  raw: unknown,
  defaultMargin: number,
): { ok: true; value: OutputMargins } | { ok: false; reason: OutputProfileReason } {
  const value: OutputMargins = { top: defaultMargin, right: defaultMargin, bottom: defaultMargin, left: defaultMargin };
  if (raw === null) return { ok: true, value };
  if (!isObject(raw)) return { ok: false, reason: 'margins_invalid' };
  if (!hasOnly(raw, SIDES)) return { ok: false, reason: 'unknown_key' };

  for (const side of SIDES) {
    if (!(side in raw)) continue;
    const entry = raw[side];
    if (typeof entry !== 'number' || !Number.isInteger(entry)) return { ok: false, reason: 'margins_invalid' };
    if (entry < MARGIN_MM[0] || entry > MARGIN_MM[1]) return { ok: false, reason: 'margins_out_of_range' };
    value[side] = entry;
  }
  return { ok: true, value };
}

/**
 * يقرأ ملف الإخراج المخزَّن في تعريف مراجعة. `null` = لا ملف ⇒ السلوك القديم
 * (A4/القاعدة العامة) بلا أي تغيير. ملف غير صالح يُعامل كغائب (فشل آمن إلى السلوك
 * القديم، لا إخراج بمقاس مخمَّن)؛ الخادم لا يخزّن غير الصالح أصلاً.
 */
export function readOutputProfile(definition: unknown): OutputProfile | null {
  if (!isObject(definition)) return null;
  const raw = definition[OUTPUT_PROFILE_KEY];
  if (raw === undefined || raw === null) return null;
  const result = normalizeOutputProfile(raw);
  return result.ok ? result.profile : null;
}

/** الورق بصيغة `PdfPaper` الموحَّدة (ارتفاع 0 للفة، كما في `PAPER_SIZES`). */
export function outputProfilePaper(profile: OutputProfile): { widthMm: number; heightMm: number } {
  if (profile.paper === CUSTOM_PAPER_ID) {
    return { widthMm: profile.custom!.width_mm, heightMm: profile.custom!.height_mm ?? 0 };
  }
  const size = PAPER_SIZES[profile.paper];
  return { widthMm: size.widthMm, heightMm: size.heightMm };
}

/**
 * يحفظ `output_profile` الخام عند إعادة بناء تعريف من حقول معروفة (المحرر يبني
 * تعريفه من مفاتيح محددة فيُسقط ما لا يعرفه). الخادم يعيد التحقق عند الحفظ.
 */
export function preserveOutputProfile(definition: unknown): { output_profile?: unknown } {
  if (!isObject(definition)) return {};
  const raw = definition[OUTPUT_PROFILE_KEY];
  return raw === undefined || raw === null ? {} : { [OUTPUT_PROFILE_KEY]: raw };
}
