<?php

namespace App\Support;

enum DocumentSourceChannel: string
{
    case WEB = 'web';
    case API = 'api';

    /** القنوات التي تملك تنفيذ استقبال داخلياً في هذه المرحلة فقط. */
    public function isInternallySupported(): bool
    {
        return $this === self::WEB;
    }
}
