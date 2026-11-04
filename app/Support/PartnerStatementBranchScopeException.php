<?php

namespace App\Support;

use RuntimeException;

/**
 * فرعٌ خارج نطاق الفاعل في `PartnerStatementImportService::assertAccess` (SEC #1974). نوعٌ مستقل **عمداً**: يحمل الرسالة المفصَّلة التاريخية نفسها، فيبقى سلوك التحقق من فرعٍ
 * **يختاره المستخدم** (معاينة/تنفيذ الاستيراد، ومرشّح الفرع في مصدر المرشحين) كما هو (`RuntimeException` ⇒ 422 بالرسالة نفسها).
 * أما مسارات «مقارنة قائمة» فالفرع فيها سياسة مجمَّدة لا مدخل، فتلتقطه `PartnerStatementMatchService` وحدها وتحوّله إلى الرفض الموحَّد `PARTNER_UNAVAILABLE`
 * كي لا يفرّق المقيَّد بفرع بين «غير موجودة» و«موجودة في فرع خارج نطاقي».
 */
final class PartnerStatementBranchScopeException extends RuntimeException
{
    public const MESSAGE = 'هذا الفرع خارج نطاق صلاحياتك.';

    public function __construct()
    {
        parent::__construct(self::MESSAGE);
    }
}
