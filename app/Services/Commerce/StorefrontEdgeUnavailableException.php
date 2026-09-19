<?php

namespace App\Services\Commerce;

use RuntimeException;

/** Railway/المزوّد غير متاح أو انتهت المهلة أو 429 — 503. */
final class StorefrontEdgeUnavailableException extends RuntimeException
{
}
