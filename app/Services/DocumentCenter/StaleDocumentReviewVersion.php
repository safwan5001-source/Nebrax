<?php

namespace App\Services\DocumentCenter;

use Symfony\Component\HttpKernel\Exception\ConflictHttpException;

final class StaleDocumentReviewVersion extends ConflictHttpException
{
    public function __construct()
    {
        parent::__construct('stale_review_version');
    }
}
