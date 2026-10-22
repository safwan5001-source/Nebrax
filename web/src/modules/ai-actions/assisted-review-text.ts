// IMP-H2-S0 — تسمية صادقة لمسار «الاستيراد بمراجعة مساعدة». المسار يستخرج ويطابق بخطواتٍ حتمية ثم يعرض المعاينة والموافقة؛ لا يعمل نموذج ذكاءٍ
// اصطناعي على بيانات الملف هنا، ومساعد أَوْج (المحادثة) غير مربوط بهذه الشاشة بعد. تعود تسمية «المساعد» مع ربط أدوات الاستيراد بالمساعد (H9-S1)
// ومعها مدخلٌ ظاهر «اسأل المساعد».
import type { Lang } from './product-execution';

export const ASSISTED_REVIEW_TEXT: Record<Lang, { title: string; notice: string }> = {
  ar: {
    title: 'استيراد بمراجعة مساعدة',
    notice:
      'تُستخرج بيانات الملف وتُطابَق بخطواتٍ حتمية (بلا نموذج ذكاء اصطناعي)، ثم تراجعها وتوافق عليها قبل أي تنفيذ. مساعد أَوْج غير مربوط بهذه الشاشة بعد.',
  },
  en: {
    title: 'Assisted review import',
    notice:
      'File data is extracted and matched by deterministic steps (no AI model), then you review and approve it before anything runs. The AWJ Assistant is not yet connected to this screen.',
  },
};
