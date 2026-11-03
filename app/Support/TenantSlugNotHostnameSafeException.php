<?php

namespace App\Support;

/**
 * معرّف المستأجر (`tenants.slug`) لا يصلح شريحة hostname لمتجر مُدار
 * (أحرف غير ASCII أو `_` أو شرطة طرفية أو أطول من 63 حرفاً أو فارغ).
 *
 * فشلٌ **خاصٌّ بالمستأجر** لا بإعداد الخادم: النطاق الأساسي سليم وقد جرى التحقق
 * منه قبل بناء الاسم. يرث `StorefrontBaseDomainMisconfiguredException` عمداً كي
 * تبقى كل المستدعيات القائمة التي تلتقط الأصل (فحص توفّر السلاج، الترحيل
 * المخطَّط، المخطِّط) على سلوكها حرفياً؛ ومتحكّم التزويد وحده يلتقط الفرع الأخصّ
 * أولاً فيردّ 422 بدل 500.
 */
class TenantSlugNotHostnameSafeException extends StorefrontBaseDomainMisconfiguredException
{
}
