<?php

namespace App\Support;

enum ApplicationOperationClass: string
{
    case READ = 'read';
    case WRITE = 'write';
    case TRANSITION = 'transition';
    case DESTRUCTIVE = 'destructive';
    case EXPORT = 'export';

    public function permitsReadOnlyAccess(): bool
    {
        return $this === self::READ;
    }
}
