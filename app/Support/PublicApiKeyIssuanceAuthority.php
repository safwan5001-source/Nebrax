<?php

namespace App\Support;

/**
 * سلطة إدارة مفاتيح Public API: الصلاحية التي يشترطها مسار واجهة المطوّر لإنشاء العملاء وإصدار المفاتيح
 * (`POST developer/api-clients` و`.../keys`). ثابتٌ واحد يشترك فيه الحارس وأمر CLI فلا يتفرّق نموذج التفويض.
 */
final class PublicApiKeyIssuanceAuthority
{
    public const PERMISSION = 'developer.manage';
}
