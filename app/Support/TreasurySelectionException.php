<?php

namespace App\Support;

use RuntimeException;

/**
 * خطأ نطاق صريح من `TreasurySelectionResolver` (TREASURY-T3). يرث `RuntimeException` فيمرّ في `ApiController::domain()` ⇒ 422 كبقية
 * أخطاء الخزائن، ويحمل `reason` ثابتاً يميّزه المستدعي والاختبارات. الرسائل عربية بلا قيم حسّاسة ولا تكشف وجود مستند عند مستأجر آخر:
 * معرّف غير موجود ومعرّف مستأجر آخر **الرسالة والرمز نفسهما** (`not_found`).
 */
final class TreasurySelectionException extends RuntimeException
{
    /** الكيان غير موجود لهذا المستأجر (يشمل معرّف مستأجر آخر). */
    public const NOT_FOUND = 'not_found';
    /** نوع الكيان (نقد/بنك) لا يطابق المطلوب. */
    public const WRONG_TYPE = 'wrong_type';
    /** الكيان معطَّل. */
    public const INACTIVE = 'inactive';
    /** حساب الأستاذ المربوط غير موجود لهذا المستأجر. */
    public const GL_ACCOUNT_MISSING = 'gl_account_missing';
    /** حساب الأستاذ المربوط معطَّل. */
    public const GL_ACCOUNT_INACTIVE = 'gl_account_inactive';
    /** حساب الأستاذ المربوط تجميعي أو ليس أصلاً — لا يقبل ترحيلاً نقدياً. */
    public const GL_ACCOUNT_INVALID = 'gl_account_invalid';
    /** لا افتراضي لهذا النوع (لا كيان رئيسي). */
    public const NO_DEFAULT = 'no_default';
    /** مرشّحون متعدّدون بلا رئيسي واحد حاسم. */
    public const AMBIGUOUS_DEFAULT = 'ambiguous_default';
    /** السياسة تفرض اختياراً صريحاً ولم يُرسَل. */
    public const EXPLICIT_REQUIRED = 'explicit_required';
    /** نطاق إيداع/سحب الكيان لا يسمح للفاعل. */
    public const NOT_PERMITTED = 'not_permitted';
    /** عملة الخزينة لا تطابق عملة المستند/المستأجر — يرميه المستدعي (T4)، لا المحلِّل. */
    public const CURRENCY_MISMATCH = 'currency_mismatch';
    /** استرداد نقدي مباشر بلا فاتورة نقدية مرحَّلة مصدراً (مستقل أو آجل) — T5/D-T5-2، يرميه المستدعي لا المحلِّل. */
    public const REFUND_SOURCE_REQUIRED = 'refund_source_required';
    /** خزينة التحصيل الأصلية في قيد البيع غير محددة بلا غموض (لا واحدة أو أكثر من واحدة) — T5/D-T5-1. */
    public const SOURCE_TREASURY_UNRESOLVED = 'source_treasury_unresolved';

    /** جلسة POS بلا خزينة مثبَّتة (جلسة قديمة) — T6/D-T6-1، يرميه المستدعي لا المحلِّل. */
    public const SESSION_TREASURY_REQUIRED = 'session_treasury_required';
    /** خزينة التحصيل النقدي الأصلية لا تطابق خزينة الجلسة التي سيُصرف منها الردّ — T6، لا صرف عبر خزائن بلا سياسة صريحة. */
    public const REFUND_TREASURY_MISMATCH = 'refund_treasury_mismatch';

    private function __construct(
        public readonly string $reason,
        string $message,
    ) {
        // الرسالة تصل المستدعي (ApiController::domain ⇒ 422 برسالة مقروءة) — بدونها كانت كل حالات الرفض تعود بنص فارغ.
        parent::__construct($message);
    }

    public static function for(string $reason): self
    {
        return new self($reason, match ($reason) {
            self::NOT_FOUND => 'الخزينة أو الحساب البنكي المختار غير موجود.',
            self::WRONG_TYPE => 'الخزينة أو الحساب البنكي المختار غير صالح لهذه العملية (النوع لا يطابق).',
            self::INACTIVE => 'الخزينة أو الحساب البنكي المختار معطّل.',
            self::GL_ACCOUNT_MISSING => 'حساب الأستاذ المربوط بالخزينة أو الحساب البنكي غير موجود.',
            self::GL_ACCOUNT_INACTIVE => 'حساب الأستاذ المربوط بالخزينة أو الحساب البنكي معطّل.',
            self::GL_ACCOUNT_INVALID => 'حساب الأستاذ المربوط بالخزينة أو الحساب البنكي لا يقبل ترحيلاً نقدياً.',
            self::NO_DEFAULT => 'لا توجد خزينة أو حساب بنكي افتراضي لهذا النوع. اختر واحداً صراحةً.',
            self::AMBIGUOUS_DEFAULT => 'توجد عدة خزائن أو حسابات بنكية بلا افتراضي حاسم. اختر واحداً صراحةً.',
            self::EXPLICIT_REQUIRED => 'يجب اختيار الخزينة أو الحساب البنكي صراحةً.',
            self::NOT_PERMITTED => 'لا تملك صلاحية العملية على هذه الخزينة أو الحساب البنكي.',
            self::CURRENCY_MISMATCH => 'عملة الخزينة أو الحساب البنكي لا تطابق عملة المؤسسة؛ لا تُحوَّل المبالغ تلقائياً. اختر خزينة بعملة المؤسسة.',
            self::REFUND_SOURCE_REQUIRED => 'الاسترداد النقدي المباشر متاح فقط لمستند مرتبط بفاتورة نقدية مرحَّلة. للمستند المستقل أو المرتبط بفاتورة آجلة أنشئ مستنداً آجلاً (رصيداً للعميل) ثم سند صرف من الخزينة المناسبة.',
            self::SESSION_TREASURY_REQUIRED => 'جلسة نقطة البيع لا تحمل خزينة مثبتة (جلسة قديمة)؛ لا يمكن ردّ نقد منها. افتح جلسة جديدة أو أنشئ رصيداً للعميل ثم سند صرف.',
            self::REFUND_TREASURY_MISMATCH => 'لا يمكن ردّ النقد من خزينة الجلسة: الفاتورة المصدر حُصِّلت نقداً في خزينة مختلفة، ولا توجد سياسة تسمح بالصرف عبر خزائن. أنشئ رصيداً للعميل ثم سند صرف من خزينة التحصيل.',
            self::SOURCE_TREASURY_UNRESOLVED => 'تعذّر تحديد خزينة التحصيل الأصلية بلا غموض (يلزم خزينة نقدية واحدة في قيد البيع). أنشئ إشعاراً آجلاً ثم سند صرف من الخزينة المناسبة.',
        });
    }
}
