<?php

namespace App\Services\DocumentCenter;

use RuntimeException;

final class DocumentSourceException extends RuntimeException
{
    public const IDENTITY_DISABLED = 'document_channel_identity_disabled';

    public const IDENTITY_NOT_FOUND = 'document_channel_identity_not_found';

    public const REFERENCE_CONFLICT = 'document_source_reference_conflict';

    public const REPLAY = 'document_source_replay';

    public const NOT_SUPPORTED = 'document_source_not_supported';

    public const METADATA_INVALID = 'document_source_metadata_invalid';

    public const ACCESS_DENIED = 'document_source_access_denied';

    public const INTAKE_REJECTED = 'document_source_intake_rejected';

    public function __construct(public readonly string $errorCode)
    {
        parent::__construct($errorCode);
    }
}
