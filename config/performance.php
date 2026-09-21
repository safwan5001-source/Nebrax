<?php

return [
    // Only requests over this threshold log; production defaults to 500ms unless configured otherwise.
    'slow_request_ms' => (int) env('AWJ_SLOW_REQUEST_MS', 500),
];
