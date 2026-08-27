<?php

namespace App\Services\DocumentCenter;

use App\Models\DocumentChannelIdentity;
use App\Models\User;
use App\Support\DocumentSourceChannel;
use Illuminate\Http\UploadedFile;

final readonly class DocumentSourceEnvelope
{
    /** @var list<string> */
    private const DOCUMENT_TYPES = [
        'purchase_invoice',
        'sales_invoice',
        'expense',
        'delivery_note',
        'receipt',
        'credit_note',
        'debit_note',
    ];

    /** @var list<string> */
    private const METADATA_KEYS = ['source_label', 'message_kind', 'received_at', 'labels', 'channel', 'reference_masked', 'identity_label'];

    /** @param array<string, mixed> $metadata */
    private function __construct(
        public DocumentChannelIdentity $identity,
        public User $actor,
        public DocumentSourceChannel $channel,
        public string $documentType,
        public string $externalReference,
        public UploadedFile $uploadedFile,
        public array $metadata,
    ) {}

    /**
     * المصدر الداخلي وحده هو من يملك identity وactor؛ لا يوجد parser لحمولة شبكة
     * ولا حقل tenant/branch/checksum/storage/workflow ضمن هذا الحد.
     *
     * @param  array<string, mixed>  $metadata
     */
    public static function fromResolvedIdentity(
        DocumentChannelIdentity $identity,
        User $actor,
        DocumentSourceChannel $channel,
        string $documentType,
        string $externalReference,
        UploadedFile $uploadedFile,
        array $metadata = [],
    ): self {
        $documentType = trim($documentType);
        if (! in_array($documentType, self::DOCUMENT_TYPES, true)) {
            throw new DocumentSourceException(DocumentSourceException::INTAKE_REJECTED);
        }
        if (! $channel->isInternallySupported()) {
            throw new DocumentSourceException(DocumentSourceException::NOT_SUPPORTED);
        }
        if ($identity->channel !== $channel) {
            throw new DocumentSourceException(DocumentSourceException::IDENTITY_NOT_FOUND);
        }

        return new self(
            identity: $identity,
            actor: $actor,
            channel: $channel,
            documentType: $documentType,
            externalReference: self::normalizeReference($channel, $externalReference),
            uploadedFile: $uploadedFile,
            metadata: self::sanitizeMetadata($metadata),
        );
    }

    public function externalReferenceFingerprint(): string
    {
        return hash('sha256', $this->externalReference);
    }

    public function externalReferenceMasked(): string
    {
        return self::mask($this->externalReference);
    }

    public static function normalizeIdentity(DocumentSourceChannel $channel, string $identity): string
    {
        return self::canonicalizeForChannel($channel, $identity);
    }

    public static function normalizeReference(DocumentSourceChannel $channel, string $reference): string
    {
        return self::canonicalizeForChannel($channel, $reference);
    }

    public static function fingerprint(string $normalized): string
    {
        return hash('sha256', $normalized);
    }

    public static function mask(string $value): string
    {
        $length = mb_strlen($value);
        if ($length <= 8) {
            return '••••';
        }

        return mb_substr($value, 0, 4).'…'.mb_substr($value, -4);
    }

    private static function canonicalizeForChannel(DocumentSourceChannel $channel, string $value): string
    {
        $value = self::normalizeIdentifier($value);
        $value = $channel->canonicalizeIdentifier($value);

        return self::normalizeIdentifier($value);
    }

    /** Core محايد: trim وحدود الطول والتحقق، بلا تحويل حالة أو دلالة قناة. */
    private static function normalizeIdentifier(string $value): string
    {
        $value = trim($value);
        if ($value === '' || mb_strlen($value) > 160) {
            throw new DocumentSourceException(DocumentSourceException::INTAKE_REJECTED);
        }

        return $value;
    }

    /** @param array<string, mixed> $metadata @return array<string, scalar|null|array<string, scalar|null>> */
    public static function sanitizeMetadata(array $metadata): array
    {
        if (count($metadata) > 12) {
            throw new DocumentSourceException(DocumentSourceException::METADATA_INVALID);
        }

        $safe = [];
        foreach ($metadata as $key => $value) {
            if (! is_string($key)
                || ! in_array($key, self::METADATA_KEYS, true)
                || preg_match('/password|secret|token|credential|authorization|raw|payload|tenant|branch|checksum|storage|workflow|scan|processing/i', $key)) {
                throw new DocumentSourceException(DocumentSourceException::METADATA_INVALID);
            }

            if ($key === 'labels') {
                if (! is_array($value) || array_is_list($value) || count($value) > 4) {
                    throw new DocumentSourceException(DocumentSourceException::METADATA_INVALID);
                }
                $labels = [];
                foreach ($value as $labelKey => $labelValue) {
                    if (! is_string($labelKey) || ! in_array($labelKey, ['category', 'locale'], true)) {
                        throw new DocumentSourceException(DocumentSourceException::METADATA_INVALID);
                    }
                    $labels[$labelKey] = self::scalar($labelValue);
                }
                $safe[$key] = $labels;

                continue;
            }

            $safe[$key] = self::scalar($value);
        }

        if (strlen((string) json_encode($safe, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE)) > 2048) {
            throw new DocumentSourceException(DocumentSourceException::METADATA_INVALID);
        }

        return $safe;
    }

    private static function scalar(mixed $value): string|int|bool|null
    {
        if (is_string($value)) {
            $value = trim($value);
            if (mb_strlen($value) > 255) {
                throw new DocumentSourceException(DocumentSourceException::METADATA_INVALID);
            }

            return $value;
        }
        if (is_int($value) || is_bool($value) || $value === null) {
            return $value;
        }

        throw new DocumentSourceException(DocumentSourceException::METADATA_INVALID);
    }
}
