<?php

namespace App\Services\Commerce;

use RuntimeException;

/** CUST-H4-6 — منتج مُهيَّأ مسبقاً كعرض على هذا المتجر (تكرار) → 409. */
final class StorefrontOfferConflictException extends RuntimeException {}
