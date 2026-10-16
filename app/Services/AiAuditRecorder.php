<?php

namespace App\Services;

use App\Models\AiAuditEvent;
use App\Tenancy\TenantContext;
use LogicException;
use Throwable;

/**
 * مسجّل التدقيق الدائم للمساعد الذكي (AI-02A) — وصفي فقط.
 *
 * يكتب حقولاً مسماة من قائمة بيضاء، و`meta` بمفاتيح أعداد/أعلام معلنة فقط (`META_KEYS`)؛ كل ما عداها
 * يسقط. لا يقبل نصاً حرّاً بطبيعته: `reason`/`event`/`tool` رموز ثابتة بنمط صارم، فلا يمرّ prompt ولا
 * ردّ ولا مفتاح ولا رقم مالي ولا نصّ مستند حتى بخطأ برمجي. الأحداث الإلزامية (قبل الإرسال الخارجي)
 * تفشل إغلاقاً: إن تعذّرت كتابتها يُمنع الاستدعاء.
 */
class AiAuditRecorder
{
    /** مفاتيح `meta` المسموحة وأنواعها. */
    public const META_KEYS = [
        'branch_mode' => 'string', 'branch_count' => 'int', 'warehouse_mode' => 'string', 'warehouse_count' => 'int',
        'message_chars' => 'int', 'tool_calls_planned' => 'int', 'tool_calls_executed' => 'int', 'billable' => 'bool',
        'overrun' => 'bool', 'row_count' => 'int', 'period_days' => 'int', 'partner_detail' => 'string',
    ];

    private const CODE = '/^[a-z][a-z0-9_.]{0,79}$/';

    public function __construct(private readonly TenantContext $tenant) {}

    /**
     * @param  array{tool?:string, provider?:string, model?:string, attempt?:int, input_tokens?:int, output_tokens?:int, cost_micro_usd?:int, meta?:array<string,mixed>}  $extra
     */
    public function record(
        string $requestId,
        string $tenantId,
        ?string $actorId,
        string $event,
        string $outcome,
        string $reason,
        array $extra = [],
        bool $required = false,
    ): bool {
        try {
            $this->write($requestId, $tenantId, $actorId, $event, $outcome, $reason, $extra);

            return true;
        } catch (Throwable $e) {
            if ($required) {
                throw $e;
            }
            report($e);

            return false;
        }
    }

    /** @param array<string,mixed> $extra */
    private function write(string $requestId, string $tenantId, ?string $actorId, string $event, string $outcome, string $reason, array $extra): void
    {
        // لا كتابة تدقيق لمستأجر غير المستأجر الحالي الموثوق.
        if ($this->tenant->has() && $this->tenant->id() !== $tenantId) {
            throw new LogicException('Audit tenant does not match the current tenant context.');
        }
        foreach ([$event, $reason] as $code) {
            if (preg_match(self::CODE, $code) !== 1) {
                throw new LogicException('Audit codes must be short snake_case identifiers.');
            }
        }
        if (! in_array($outcome, ['allowed', 'denied', 'error'], true)) {
            throw new LogicException('Unknown audit outcome.');
        }

        $tool = $extra['tool'] ?? null;
        if ($tool !== null && preg_match(self::CODE, $tool) !== 1) {
            throw new LogicException('Audit tool must be a short identifier.');
        }

        AiAuditEvent::query()->create([
            'request_id' => $requestId,
            'tenant_id' => $tenantId,
            'actor_id' => $actorId,
            'feature' => 'assistant',
            'event' => $event,
            'tool' => $tool,
            'provider' => isset($extra['provider']) ? substr((string) $extra['provider'], 0, 32) : null,
            'model' => isset($extra['model']) ? substr((string) $extra['model'], 0, 64) : null,
            'outcome' => $outcome,
            'reason' => $reason,
            'attempt' => isset($extra['attempt']) ? (int) $extra['attempt'] : null,
            'input_tokens' => isset($extra['input_tokens']) ? (int) $extra['input_tokens'] : null,
            'output_tokens' => isset($extra['output_tokens']) ? (int) $extra['output_tokens'] : null,
            'cost_micro_usd' => isset($extra['cost_micro_usd']) ? (int) $extra['cost_micro_usd'] : null,
            'meta' => $this->meta($extra['meta'] ?? []),
            'occurred_at' => now(),
        ]);
    }

    /** @param array<string,mixed> $meta @return array<string,int|bool|string>|null */
    private function meta(array $meta): ?array
    {
        $clean = [];
        foreach (self::META_KEYS as $key => $type) {
            if (! array_key_exists($key, $meta)) {
                continue;
            }
            $value = $meta[$key];
            $clean[$key] = match ($type) {
                'int' => (int) $value,
                'bool' => (bool) $value,
                default => preg_match('/^[a-z_]{1,24}$/', (string) $value) === 1 ? (string) $value : null,
            };
            if ($clean[$key] === null) {
                unset($clean[$key]);
            }
        }

        return $clean === [] ? null : $clean;
    }
}
