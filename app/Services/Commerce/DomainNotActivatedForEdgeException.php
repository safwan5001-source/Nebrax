<?php

namespace App\Services\Commerce;

use RuntimeException;

/** Refresh على نطاق لم يُفعَّل Edge بعد — 422. */
final class DomainNotActivatedForEdgeException extends RuntimeException
{
}
