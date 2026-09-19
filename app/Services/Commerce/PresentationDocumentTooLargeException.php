<?php

namespace App\Services\Commerce;

use RuntimeException;

/** STORE-BACKEND-1 — جسم الطلب أو JSON المخزَّن يتجاوز 1.5 ميبيبايت. */
final class PresentationDocumentTooLargeException extends RuntimeException
{
    public function __construct()
    {
        parent::__construct('مستند المظهر أكبر من الحد المسموح.');
    }
}
