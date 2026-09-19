<?php

namespace App\Services\Commerce;

use RuntimeException;

/**
 * STORE-ADMIN-ADOPT-1B-3B — نطاق AWJ مُدار موجود ومملوك، لكنه غير مؤهل
 * ليكون أساسياً (غير موثَّق أو غير نشط وفق invariants الحالية). 422 لا 404:
 * لا تسريب وجود هنا.
 */
final class DomainNotEligibleForPrimaryException extends RuntimeException
{
}
