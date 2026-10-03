<?php

namespace App\Services\Commerce;

use RuntimeException;

/** FLOWERS-H2 — تعارض حالة في التصنيف التجاري (تكرار/استخدام قائم) → 409. */
final class CommerceTaxonomyConflictException extends RuntimeException {}
