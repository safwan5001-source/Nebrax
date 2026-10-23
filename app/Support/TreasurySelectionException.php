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

    private function __construct(
        public readonly string $reason,
        string $message,
    ) {}

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
        });
    }
}
