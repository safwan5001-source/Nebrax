<?php

namespace App\Support;

use InvalidArgumentException;

/**
 * سياسة حدّ المعدّل للـ Public API — أرقام محافظة **مبنية على أدلّة المستودع**،
 * لا أرقامًا توضيحية منقولة.
 *
 * الأدلّة (وقت الكتابة):
 *  - نشرٌ على Render خطة **free** بنسخة **واحدة** (`render.yaml`: nibras-api web،
 *    plan: free، بلا numInstances) — لا تعدّد نسخ.
 *  - `CACHE_STORE=file` (Dockerfile) — عدّادات الحدّ على قرص النسخة الواحدة،
 *    فهي عمليًا **شاملة** ما دامت النسخة واحدة. لا Redis في المستودع.
 *  - `QUEUE_CONNECTION=sync` — كل طلب (وأي كتابة مستقبلية) يُعالَج داخل عامل
 *    الويب نفسه، فالضغط يستهلك مباشرةً موارد النسخة المحدودة.
 *  - الـ Internal API محافظ بالفعل: `throttle:5,1`/`3,1` للعمليات الحسّاسة،
 *    `throttle:20,1` لكتابات مركز المستندات — فأرقامنا تتّسق مع هذا الطابع.
 *
 * القرار: نافذة دقيقة واحدة، وحدود **لكل عميل API** (لا IP وحده):
 *  - read      = 100/دقيقة  (قراءة مقسَّمة رخيصة؛ تكفي مسحَ الكتالوج والاستطلاع).
 *  - write     =  30/دقيقة  (بذرة PR-5؛ الكتابة تمرّ بخدمات الدومين والقيد، أثقل).
 *  - sensitive =  10/دقيقة  (بذرة؛ عمليات مجمّعة/حسّاسة مستقبلية).
 *  - unauth    =  30/دقيقة  (حماية IP لأي مسار عام غير مصادَق مستقبلي).
 *
 * ⚠️ **قيد موثَّق:** مع `file` cache والنسخة الواحدة، الحدود شاملة اليوم. لو
 * تُوسِّع أفقيًا (نسخ متعددة) تصبح العدّادات **لكل نسخة** فتضعف الحدود العالمية،
 * ويلزم مخزنٌ مشترك (Redis/DB) للاتساق الموزّع — خارج نطاق PR-4 صراحةً.
 *
 * هذه القيم هي **نقطة الضبط**؛ تُرفع لاحقًا إلى `config`/إعداد مؤسسة عند الحاجة.
 */
final class PublicApiRateLimits
{
    /** نافذة الحدّ (ثوانٍ) — دقيقة واحدة. */
    public const WINDOW_SECONDS = 60;

    public const CLASS_READ      = 'read';
    public const CLASS_WRITE     = 'write';
    public const CLASS_SENSITIVE = 'sensitive';
    public const CLASS_UNAUTH    = 'unauth';

    /** الحدّ الأقصى للطلبات في النافذة لكل فئة. */
    private const LIMITS = [
        self::CLASS_READ      => 100,
        self::CLASS_WRITE     => 30,
        self::CLASS_SENSITIVE => 10,
        self::CLASS_UNAUTH    => 30,
    ];

    /** حدّ الفئة، أو استثناء لفئةٍ غير معروفة (خطأ تهيئة يُكشف مبكرًا). */
    public static function limitFor(string $rateClass): int
    {
        if (! array_key_exists($rateClass, self::LIMITS)) {
            throw new InvalidArgumentException("فئة حدّ معدّل غير معروفة: «{$rateClass}».");
        }

        return self::LIMITS[$rateClass];
    }

    public static function isKnown(string $rateClass): bool
    {
        return array_key_exists($rateClass, self::LIMITS);
    }
}
