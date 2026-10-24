<?php

namespace App\Services\Commerce;

use RuntimeException;

/** رفض عمل داخل جسر الطلب المدفوع (H4-03): يتراجع عمّا أنشأه الجسر ويُسجَّل الالتقاط `not_postable` برمز ثابت للمراجعة. */
final class CommerceOrderPostingRejection extends RuntimeException
{
    public function __construct(public readonly string $reason)
    {
        parent::__construct($reason);
    }
}
