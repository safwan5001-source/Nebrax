<?php

namespace App\Support;

enum DocumentScanStatus: string
{
    case PENDING = 'pending';
    case CLEAN = 'clean';
    case INFECTED = 'infected';
    case FAILED = 'failed';
}
