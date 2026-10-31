<?php

namespace App\Services\Commerce;

use RuntimeException;

/**
 * H6 Quick Order — thrown by {@see CommerceCartService::addMany()} AFTER every line has been evaluated, when at least one
 * line is not purchasable. The surrounding transaction rolls back, so nothing was added. It carries every failing line (by
 * its position in the submitted list) so the buyer can fix them all in one pass.
 */
final class CommerceCartBatchRejectedException extends RuntimeException
{
    /** @param list<array{index: int, reason: string}> $failures */
    public function __construct(public readonly array $failures)
    {
        parent::__construct('Some quick-order lines are not purchasable; nothing was added.');
    }
}
