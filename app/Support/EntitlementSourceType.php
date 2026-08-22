<?php

namespace App\Support;

enum EntitlementSourceType: string
{
    case PLAN = 'plan';
    case ADDON = 'addon';
    case TRIAL = 'trial';
    case PROMOTION = 'promotion';
    case MANUAL = 'manual';
    case LEGACY_GRANDFATHER = 'legacy_grandfather';
    case ADMINISTRATIVE_OVERRIDE = 'administrative_override';
}
