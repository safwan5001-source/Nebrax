<?php

return [
    // AIA-0.1 (D-02 §1.2.5): when a statement's server-side integrity checks fail, the default is to stay
    // backward compatible — the legacy fields are still returned, but `report_status` is `unverified` and
    // `display`/`position` are withheld, so nothing can be presented as final. Setting this flag makes the
    // endpoint refuse instead (500, no statement data). Ships OFF; enabling it is a separate owner decision
    // after reviewing real statements.
    'statement_reject_on_integrity_failure' => filter_var(
        env('PUBLIC_API_STATEMENT_REJECT_ON_INTEGRITY_FAILURE', false),
        FILTER_VALIDATE_BOOLEAN
    ),
];
