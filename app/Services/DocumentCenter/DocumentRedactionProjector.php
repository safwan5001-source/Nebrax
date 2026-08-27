<?php

namespace App\Services\DocumentCenter;

use App\Models\DocumentExtractionResult;
use App\Models\DocumentRedactionOverlay;

final class DocumentRedactionProjector
{
    public const MARKER = '[REDACTED]';

    private const FIELD_PATHS = [
        'fields.issuer_name',
        'fields.issuer_tax_number',
        'fields.recipient_name',
        'fields.recipient_tax_number',
        'fields.document_number',
        'fields.external_reference',
        'fields.purchase_order_number',
        'lines.*.description',
        'lines.*.sku',
        'lines.*.barcode',
    ];

    public static function allows(string $fieldPath): bool
    {
        return in_array($fieldPath, self::FIELD_PATHS, true);
    }

    /** @return array<int,string> */
    public static function fieldPaths(): array
    {
        return self::FIELD_PATHS;
    }

    public function isRedacted(DocumentExtractionResult $result, string $fieldPath): bool
    {
        return self::allows($fieldPath)
            && DocumentRedactionOverlay::query()
                ->where('document_extraction_result_id', $result->id)
                ->where('field_path', $fieldPath)
                ->exists();
    }

    /** @param array<string,mixed> $projection
     * @return array<string,mixed>
     */
    public function apply(DocumentExtractionResult $result, array $projection): array
    {
        $paths = DocumentRedactionOverlay::query()
            ->where('document_extraction_result_id', $result->id)
            ->orderBy('redacted_at')
            ->pluck('field_path')
            ->all();

        foreach ($paths as $path) {
            $this->redact($projection, $path);
        }

        return $projection;
    }

    /** @param array<string,mixed> $projection */
    private function redact(array &$projection, string $path): void
    {
        if (! self::allows($path)) {
            return;
        }
        $parts = explode('.', $path);
        if (($parts[0] ?? null) === 'lines' && ($parts[1] ?? null) === '*') {
            $key = $parts[2] ?? null;
            if ($key !== null && is_array($projection['lines'] ?? null)) {
                foreach ($projection['lines'] as &$line) {
                    if (is_array($line) && array_key_exists($key, $line)) {
                        $line[$key] = self::MARKER;
                    }
                }
                unset($line);
            }

            return;
        }

        if (($parts[0] ?? null) === 'fields' && isset($parts[1])
            && is_array($projection['fields'] ?? null) && array_key_exists($parts[1], $projection['fields'])) {
            $projection['fields'][$parts[1]] = self::MARKER;
        }
    }
}
