<?php

namespace App\Services\AppBuilder;

/**
 * مشكلة عقد واحدة في مخطط مسودة — AD-12 (S02).
 *
 * `severity = error` ⇒ **تمنع النشر** (تظهر عند الحفظ كتحذير غير حاجب)؛ `warning` ⇒ لا تمنع النشر.
 * `code` ثابت لترجمة الواجهة؛ `message` عربي افتراضي من الخادم. لا يحمل أي قيمة من المخطط نفسه
 * (نص التاجر قد يكون حساساً): فقط معرّفات الصفحة/العقدة ومفتاح الخاصية.
 */
final class ContractIssue
{
    public const ERROR = 'error';

    public const WARNING = 'warning';

    public function __construct(
        public readonly string $code,
        public readonly string $severity,
        public readonly string $pageId,
        public readonly ?string $nodeId,
        public readonly ?string $field,
        public readonly string $message,
    ) {}

    public function blocksPublish(): bool
    {
        return $this->severity === self::ERROR;
    }

    /** @return array{code: string, severity: string, page_id: string, node_id: ?string, field: ?string, message: string, blocks_publish: bool} */
    public function toArray(): array
    {
        return [
            'code' => $this->code,
            'severity' => $this->severity,
            'page_id' => $this->pageId,
            'node_id' => $this->nodeId,
            'field' => $this->field,
            'message' => $this->message,
            'blocks_publish' => $this->blocksPublish(),
        ];
    }
}
