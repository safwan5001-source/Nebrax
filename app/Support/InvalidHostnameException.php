<?php

namespace App\Support;

use RuntimeException;

/**
 * مدخل مضيف غير صالح لا يمكن تطبيعه إلى hostname قابل للاستخدام في حسم
 * Storefront/Tenant — فارغ، يحمل بيانات اعتماد/مخطط لا يمكن فصله، أو يخالف
 * تركيب اسم النطاق (تسمية/طول). يُرمى من `HostnameNormalizer::normalize()`
 * فقط؛ المستدعي (وسيط الحسم عادةً) يحوّله إلى فشل مغلق غير كاشف (404)، لا
 * أي محاولة تخمين أو تصحيح.
 */
class InvalidHostnameException extends RuntimeException
{
}
