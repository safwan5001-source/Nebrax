<?php

return [
    // Category images are operational media and must survive container rebuilds.
    // Keep the flag off by default for backward compatibility; Production can
    // opt in explicitly after the R2 credentials already used by product media
    // are confirmed.
    'r2' => [
        'enabled' => filter_var(env('CATEGORY_MEDIA_R2_ENABLED', false), FILTER_VALIDATE_BOOL),
    ],
];
