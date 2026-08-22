<?php

namespace App\Support;

enum EntitlementAccessMode: string
{
    case FULL = 'full';
    case READ_ONLY = 'read_only';
}
