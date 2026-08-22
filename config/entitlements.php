<?php

return [
    // off = legacy only; shadow = observational; enforce_cohort = selected trusted tenants only.
    'mode' => env('ENTITLEMENT_MODE', 'off'),

    // Platform-controlled comma-separated UUID allowlist. Empty by default.
    'enforce_tenants' => env('ENTITLEMENT_ENFORCE_TENANTS', ''),
];
