<?php

namespace App\Services\Commerce;

use RuntimeException;

/** النطاق محجوز لدى المزوّد خارج خدمتنا — 409. */
final class StorefrontEdgeConflictException extends RuntimeException
{
}
