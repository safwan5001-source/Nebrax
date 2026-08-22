<?php

namespace App\Support;

enum TenantApplicationEntitlementDecision: string
{
    case FULL = 'full';
    case READ_ONLY = 'read_only';
    case DENIED = 'denied';
}
