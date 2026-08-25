<?php

namespace App\Services\DocumentCenter;

use LogicException;

final class DocumentReviewMutationGate
{
    private static int $depth = 0;

    public static function run(callable $callback): mixed
    {
        self::$depth++;
        try {
            return $callback();
        } finally {
            self::$depth--;
        }
    }

    public static function assertOpen(): void
    {
        if (self::$depth < 1) {
            throw new LogicException('Match and issue review decisions must be changed through DocumentReviewService.');
        }
    }
}
