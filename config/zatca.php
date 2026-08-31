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

    /*
    |--------------------------------------------------------------------------
    | XAdES signature policy
    |--------------------------------------------------------------------------
    |
    | Pin the exact identifier and SHA-256 digest published by the applicable
    | ZATCA security standard. There is deliberately no default: signing must
    | fail closed instead of embedding a guessed or stale policy.
    |
    */
    'signature_policy' => [
        'identifier' => env('ZATCA_SIGNATURE_POLICY_IDENTIFIER'),
        'digest' => env('ZATCA_SIGNATURE_POLICY_DIGEST'),
    ],

    /*
    |--------------------------------------------------------------------------
    | Official Reporting and Clearance endpoints
    |--------------------------------------------------------------------------
    |
    | These addresses are deliberately pinned to ZATCA's published FATOORA
    | portal endpoints. The developer environment has no Core Solution URL in
    | that publication, so transport fails closed there instead of guessing.
    |
    */
    'submission_endpoints' => [
        'simulation' => [
            'reporting' => 'https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation/invoices/reporting/single',
            'clearance' => 'https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation/invoices/clearance/single',
        ],
        'production' => [
            'reporting' => 'https://gw-fatoora.zatca.gov.sa/e-invoicing/core/invoices/reporting/single',
            'clearance' => 'https://gw-fatoora.zatca.gov.sa/e-invoicing/core/invoices/clearance/single',
        ],
    ],

    'transport' => [
        // Must be enabled explicitly after queue workers and credentials are verified.
        'dispatch_enabled' => env('ZATCA_SUBMISSION_DISPATCH_ENABLED', false),
        'queue_connection' => env('ZATCA_SUBMISSION_QUEUE_CONNECTION'),
        'queue' => env('ZATCA_SUBMISSION_QUEUE', 'zatca'),
        'connect_timeout_seconds' => 5,
        'timeout_seconds' => 30,
    ],
];
