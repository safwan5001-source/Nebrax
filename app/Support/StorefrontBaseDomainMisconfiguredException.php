<?php

namespace App\Support;

use RuntimeException;

/**
 * النطاق الأساسي لمتاجر Commerce المُدارة (`config('storefront.managed_base_domain')`)
 * غير مضبوط أو غير صالح، أو تعذّر توليد hostname مثبَتٍ تحته لمستأجر بعينه —
 * يُرمى من `ManagedStorefrontHostname` حصراً. المستدعي (خدمة التزويد) يحوّله
 * إلى فشلٍ مغلق **قبل** أي كتابة على `sales_channels`/`storefronts`
 * /`storefront_domains` — لا رسم جزئي للرسم البياني بسبب إعداد ناقص.
 */
class StorefrontBaseDomainMisconfiguredException extends RuntimeException
{
}
