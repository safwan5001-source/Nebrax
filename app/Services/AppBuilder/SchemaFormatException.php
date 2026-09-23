<?php

namespace App\Services\AppBuilder;

use RuntimeException;

/**
 * مشكلة بنيوية/نوعية/مفتاح غير معروف أثناء تحقّق App Schema. `$code` معرّف
 * ثابت قابل للاختبار (لا نص مُترجَم) — يطابق حرفياً رموز
 * `mobile/lib/schema/app_schema.dart`'s `SchemaFormatException` (نفس الأسماء:
 * `invalid_json`, `invalid_type`, `missing_field`, `invalid_version`,
 * `unknown_field`, `too_deep`, `too_many_nodes`) حتى يتوافق تشخيص فشل الواجهة
 * لاحقاً مع نفس الرموز على الجوال والخلفية معاً. مطابقٌ أيضاً لاصطلاح الأرصدة
 * الافتتاحية للمخزون («رسائل الأخطاء برمزٍ ثابت»، `CLAUDE.md`).
 */
class SchemaFormatException extends RuntimeException
{
    /**
     * اسمها `errorCode` لا `code`: الصنف الأساس `\Exception` يعلن بالفعل
     * خاصية `$code` (عدد صحيح، متوافقة مع SQLSTATE تقليدياً) — إعادة إعلانها
     * هنا `readonly` من نوع `string` تصطدم بتعريف PHP الداخلي (خطأ فادح وقت
     * التحميل: «Cannot redeclare non-readonly property»).
     */
    public readonly string $errorCode;

    public function __construct(string $errorCode, string $message)
    {
        parent::__construct($message);
        $this->errorCode = $errorCode;
    }
}
