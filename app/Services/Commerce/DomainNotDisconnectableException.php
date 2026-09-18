<?php

namespace App\Services\Commerce;

use RuntimeException;

/**
 * STORE-ADMIN-ADOPT-1B-3B — رفض فصل نطاق: إمّا أنه مُدار من أَوْج
 * (`awj_subdomain`) أو أنه النطاق الأساسي الحالي. فشلٌ مغلق — لا حذف
 * ولا إعادة تعيين أساسي ضمن هذا المسار. 422 لا 404: النطاق موجود ومملوك.
 */
final class DomainNotDisconnectableException extends RuntimeException
{
}
