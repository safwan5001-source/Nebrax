<?php

namespace App\Services\Commerce;

use RuntimeException;

/**
 * hostname المتجر المُدار المولَّد (`{tenant-slug}.{managed-base-domain}`)
 * مسجَّلٌ بالفعل كـ`StorefrontDomain` يخصّ مستأجراً أو متجراً آخر —
 * `StorefrontProvisioningService` يفشل مغلقاً، لا يعيد تخصيص النطاق ولا
 * يحذفه ولا يكتب فوقه.
 */
final class StorefrontHostnameConflictException extends RuntimeException
{
}
