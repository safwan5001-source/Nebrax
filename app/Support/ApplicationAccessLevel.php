<?php

namespace App\Support;

enum ApplicationAccessLevel: string
{
    case ALLOWED = 'allowed';
    case READ_ONLY = 'read_only';
    case DENIED = 'denied';
}
