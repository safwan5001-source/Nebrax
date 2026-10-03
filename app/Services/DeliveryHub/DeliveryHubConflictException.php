<?php

namespace App\Services\DeliveryHub;

use RuntimeException;

/** نفس مفتاح الإدخال أو نفس هوية المزود بحمولة مختلفة. ليس صفاً جديداً. */
class DeliveryHubConflictException extends RuntimeException
{
}
