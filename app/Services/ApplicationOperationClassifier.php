<?php

namespace App\Services;

use App\Support\ApplicationOperationClass;
use Illuminate\Http\Request;

/** Maps verified controller actions to semantics; HTTP verb alone never establishes a safe read. */
class ApplicationOperationClassifier
{
    public function classify(Request $request): ApplicationOperationClass
    {
        $method = strtolower((string) $request->route()?->getActionMethod());

        return match ($method) {
            // Resource reads plus verified report/detail actions that only query existing data.
            'index', 'show', 'sources', 'returnable',
            'products', 'heldsales', 'returnableinvoice', 'returnableinvoices',
            'report', 'cashmovements', 'events',
            'accounting', 'inventory', 'payments', 'notes', 'zatca',
            'indexattachments', 'indexcontracts', 'indexleaverequests', 'indexrequests',
            'leavebalances', 'showphoto', 'movements',
            'profile', 'contract', 'payrollitems', 'attendances', 'stock' => ApplicationOperationClass::READ,

            // Downloading an existing private attachment is intentionally distinct from reading API data.
            'download', 'downloadattachment', 'downloadnoteattachment' => ApplicationOperationClass::EXPORT,

            'destroy', 'delete', 'remove' => ApplicationOperationClass::DESTRUCTIVE,
            'post', 'approve', 'reject', 'cancel', 'close', 'reopen', 'checkin', 'checkout' => ApplicationOperationClass::TRANSITION,
            'export' => ApplicationOperationClass::EXPORT,

            // Unknown actions, including unknown GET handlers, fail conservative as write.
            default => ApplicationOperationClass::WRITE,
        };
    }
}
