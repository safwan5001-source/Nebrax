<?php

return [
    /*
    |--------------------------------------------------------------------------
    | ZATCA certificate trust anchors
    |--------------------------------------------------------------------------
    |
    | Each path must point to a PEM CA bundle for the matching ZATCA
    | environment. Keep CA bundles outside the repository and rotate them
    | through the deployment secret/configuration channel.
    |
    */
    'trust_anchors' => [
        'developer' => env('ZATCA_DEVELOPER_CA_BUNDLE'),
        'simulation' => env('ZATCA_SIMULATION_CA_BUNDLE'),
        'production' => env('ZATCA_PRODUCTION_CA_BUNDLE'),
    ],
];
