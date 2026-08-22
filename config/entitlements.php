<?php

return [
    // Deployment rollout control only. Entitlements are observational in Phase 2.
    'mode' => env('ENTITLEMENT_MODE', 'off'),
];
