<?php

namespace App\Services\Commerce;

use RuntimeException;

/** نطاق غير مؤهل لتفعيل Edge — 422. */
final class DomainNotEligibleForEdgeException extends RuntimeException
{
}
