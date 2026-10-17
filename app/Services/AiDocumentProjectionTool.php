<?php

namespace App\Services;

use App\Contracts\AiAssistantTool;
use App\Contracts\AiExplicitInvocationOnly;
use App\Models\User;
use App\Support\AiAssistantDataCategory;
use InvalidArgumentException;

/**
 * أداة قراءة نصّ مستند مُسقَط (AI-04): **قراءة فقط**، صريحة الاستدعاء من المستخدم فقط (`AiExplicitInvocationOnly`).
 *
 * المعطى الوحيد معرّف حزمة المستند (UUID) الذي حدّده المستخدم من شاشته. لا مسار ولا رابط ولا SQL ولا اختيار
 * مزوّد. التفويض (المنصة ∩ المستأجر ∩ موافقة `document_projected_text` ∩ `ai.assistant.use` ∩ `documents.center.view`
 * ∩ نطاق الفرع ∩ حالة المستند) يُعاد عند كل استدعاء، والقراءة نفسها في `AiDocumentProjectionReader`.
 */
class AiDocumentProjectionTool implements AiAssistantTool, AiExplicitInvocationOnly
{
    public const NAME = 'documents.projected_read';

    public function __construct(private readonly AiDocumentProjectionReader $reader) {}

    public function name(): string
    {
        return self::NAME;
    }

    public function requiredPermission(): string
    {
        return 'documents.center.view';
    }

    public function dataCategory(): string
    {
        return AiAssistantDataCategory::DOCUMENT_PROJECTED_TEXT;
    }

    public function supportsWarehouseScope(): bool
    {
        return false;
    }

    public function validate(array $arguments): array
    {
        if (array_diff(array_keys($arguments), ['document_id']) !== []) {
            throw new InvalidArgumentException('unsupported_argument');
        }
        $id = $arguments['document_id'] ?? null;
        if (! is_string($id) || preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $id) !== 1) {
            throw new InvalidArgumentException('invalid_document_id');
        }

        return ['document_id' => strtolower($id)];
    }

    public function auditMeta(array $result): array
    {
        $fields = (array) ($result['fields'] ?? []);
        $lines = (array) ($result['lines'] ?? []);

        return [
            'document_ref' => (string) ($result['document']['ref'] ?? ''),
            'document_type' => (string) ($result['document']['document_type'] ?? ''),
            'document_status' => (string) ($result['document']['status'] ?? ''),
            'fields_returned' => count($fields),
            'lines_returned' => count($lines),
            'redactions_applied' => (int) ($result['basis']['redacted_values'] ?? 0),
        ];
    }

    public function execute(User $actor, array $arguments, array $branchScope, array $warehouseScope): array
    {
        return $this->reader->read($actor, $arguments['document_id'], $branchScope);
    }
}
