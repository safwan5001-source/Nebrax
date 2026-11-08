import type { PdfPaper } from '@/lib/pdf';
import { PAPER_SIZES } from '@/modules/documents/constants/paper';
import { getTemplate } from '@/modules/documents/registry/templates';
import {
  CUSTOM_PAPER_ID,
  outputProfilePaper,
  type OutputMargins,
  type OutputProfile,
} from '@/modules/print-templates/services/output-profile';

/**
 * حلّ المقاس الفعلي للمستند من Output Profile (AWJ-DOC-V2-PR3B).
 *
 * نقطة قرار واحدة تستهلكها المعاينة والطباعة وPDF معاً، فلا تختلف الأبعاد بينها:
 *  • **غياب الملف = السلوك السابق حرفياً**: `paper` من `supportedPaper[0]` للقالب (A4 غالباً)
 *    و`frame = null` فيبقى إطار الصفحة الثابت 210mm وهامش `@page` العام.
 *  • ملف لا يدعمه القالب (مقاس لم يُثبَت تخطيطه) **يُعامل كغائب** — فشل آمن إلى السلوك السابق،
 *    لا إخراج بمقاس مخمَّن. ملاءمة المقاس تُحكم بـ`supportedPaper` و`minPageWidthMm` وحدهما.
 *  • الرول (الحراري) مقاسه من القالب نفسه؛ الهوامش لا تُطبَّق عليه (القالب الحراري يحمل حشوه).
 *  • الورق ذو الصفحات: العنصر الملتقَط عرضه = الورق − الهامشين (يطابقه `@page` في الطباعة وموضع
 *    الصورة في PDF)، فتتطابق المعاينة والطباعة وPDF في العرض والتدفق.
 */

/** إطار صفحة المحتوى كما يرسمه `DocLayout` (مم). */
export interface DocPageFrame {
  paperWidthMm: number;
  paperHeightMm: number;
  marginsMm: OutputMargins;
  /** عرض جذر المستند = الورق − الهامشين. */
  contentWidthMm: number;
  /** أدنى ارتفاع لجذر المستند في المعاينة = الورق − الهامشين العلوي والسفلي. */
  contentMinHeightMm: number;
}

export interface DocumentOutputSpec {
  /** الملف المطبَّق فعلاً؛ `null` = السلوك السابق (غائب أو غير مدعوم من القالب). */
  profile: OutputProfile | null;
  /** يمرّ كما هو إلى `printDocument` و`documentExporter`. */
  paper: PdfPaper;
  /** إطار الصفحة للمعاينة؛ `null` = الإطار الثابت القديم (A4 210mm) أو الرول. */
  frame: DocPageFrame | null;
}

export type OutputProfileFit =
  | { supported: true }
  | {
      supported: false;
      reason: 'paper_not_supported' | 'custom_not_supported' | 'roll_not_supported' | 'content_too_narrow';
      /** عند `content_too_narrow`: أدنى عرض محتوى يدعمه القالب (مم). */
      minContentWidthMm?: number;
    };

/**
 * هل يدعم قالبٌ هذا الملف؟ يحكمه ما أُثبت بالاختبار فقط:
 *  • مقاس ثابت ⇒ ضمن `supportedPaper`؛ ومخصص ⇒ للصفحات (لا رول) وللقوالب التي أعلنت `minContentWidthMm`.
 *  • عرض المحتوى (الورق − الهامشين) ≥ `minContentWidthMm` — فالهوامش الكبيرة قد تُسقط الدعم.
 *  • الرول: المقاس من القالب الحراري نفسه ويُشترط وروده في `supportedPaper`.
 */
export function outputProfileFit(profile: OutputProfile, templateId: string | null | undefined): OutputProfileFit {
  const template = getTemplate(templateId);

  if (profile.output_mode === 'roll') {
    return profile.paper !== CUSTOM_PAPER_ID && template.supportedPaper.includes(profile.paper)
      ? { supported: true }
      : { supported: false, reason: 'roll_not_supported' };
  }

  const min = template.minContentWidthMm;
  if (min === undefined) return { supported: false, reason: profile.paper === CUSTOM_PAPER_ID ? 'custom_not_supported' : 'paper_not_supported' };
  if (profile.paper !== CUSTOM_PAPER_ID && !template.supportedPaper.includes(profile.paper)) {
    return { supported: false, reason: 'paper_not_supported' };
  }

  const paper = outputProfilePaper(profile);
  const contentWidth = paper.widthMm - profile.margins_mm.left - profile.margins_mm.right;
  return contentWidth >= min
    ? { supported: true }
    : { supported: false, reason: 'content_too_narrow', minContentWidthMm: min };
}

function legacySpec(templateId: string | null | undefined): DocumentOutputSpec {
  const paperId = getTemplate(templateId).supportedPaper[0] ?? 'a4';
  const size = PAPER_SIZES[paperId];

  return { profile: null, paper: { widthMm: size.widthMm, heightMm: size.heightMm }, frame: null };
}

export function resolveDocumentOutputSpec(
  templateId: string | null | undefined,
  profile: OutputProfile | null | undefined,
): DocumentOutputSpec {
  if (!profile || !outputProfileFit(profile, templateId).supported) return legacySpec(templateId);

  const base = outputProfilePaper(profile);
  if (profile.output_mode === 'roll') {
    return { profile, paper: base, frame: null };
  }

  const m = profile.margins_mm;
  return {
    profile,
    paper: { ...base, marginsMm: { ...m } },
    frame: {
      paperWidthMm: base.widthMm,
      paperHeightMm: base.heightMm,
      marginsMm: { ...m },
      contentWidthMm: base.widthMm - m.left - m.right,
      contentMinHeightMm: base.heightMm - m.top - m.bottom,
    },
  };
}
