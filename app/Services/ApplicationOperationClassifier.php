<?php

namespace App\Services;

use App\Support\ApplicationOperationClass;
use Illuminate\Http\Request;

/** Maps known controller actions to semantics; HTTP verb alone never establishes a safe read. */
class ApplicationOperationClassifier
{
    public function classify(Request $request): ApplicationOperationClass
    {
        $method = strtolower((string) $request->route()?->getActionMethod());

        return match ($method) {
            'index', 'show', 'sources', 'returnable' => ApplicationOperationClass::READ,
            'destroy', 'delete', 'remove' => ApplicationOperationClass::DESTRUCTIVE,
            'post', 'approve', 'reject', 'cancel', 'close', 'reopen', 'checkin', 'checkout' => ApplicationOperationClass::TRANSITION,
            'export', 'download' => ApplicationOperationClass::EXPORT,
            default => ApplicationOperationClass::WRITE,
        };
    }
}
