<?php

namespace App\Services;

use App\Contracts\AiAssistantProvider;
use App\Models\AiRequest;
use App\Models\User;
use App\Support\AiAssistantDataCategory;
use App\Support\AiAssistantDenied;
use App\Support\AiAssistantPricing;
use App\Support\AiProviderException;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Throwable;

/**
 * بوابة المساعد الذكي (AWJ Intelligence) — تنسيقٌ فقط، بلا بيانات ولا شبكة في هذه المرحلة.
 *
 * التسلسل الثابت لكل طلب، وأي رفض يوقفه قبل بناء أي prompt وقبل أي استدعاء للمزوّد:
 *   ١. تفويض (المنصة ∩ المستأجر ∩ الفاعل الطازج ∩ فئات البيانات)
 *   ٢. نطاق الفرع/المخزن — رفض صريح للممنوع
 *   ٣. المزوّد (`mock` وحده؛ غيره يفشل مغلقاً) + تسعيره (غير المعرَّف يُرفض)
 *   ٤. فتح الطلب: مفتاح التكرار + **حجز الميزانية** (عالمية ثم المستأجر، ذرّياً) قبل أي استدعاء
 *   ٥. تدقيق `request.started` **إلزامي ودائم** قبل الاستدعاء (تعذّره يمنع الاستدعاء)
 *   ٦. استدعاء المزوّد ثم **التسوية** بالاستهلاك الفعلي (أو بسياسة الفشل)
 *   ٧. لكل استدعاء أداة يقترحه المزوّد: سجلّ مغلق ← إعادة تفويض كاملة بفاعل طازج ← إعادة حلّ النطاق
 *      ← تنفيذ.
 *
 * المستأجر والفاعل يأتيان من السياق الموثوق فقط. التدقيق: صفوف `ai_audit_events` الدائمة + سطر سجلّ
 * تشغيلي — بيانات وصفية (معرّفات، رموز نتائج، أعداد، رموز/تكلفة) لا نصّ رسالة ولا ردّ ولا أي سرّ.
 */
class AiAssistantGateway
{
    public function __construct(
        private readonly AiAssistantPolicy $policy,
        private readonly AiAssistantScopeGuard $scopeGuard,
        private readonly AiAssistantToolRegistry $tools,
        private readonly MockAiAssistantProvider $mockProvider,
        private readonly AiRequestLedger $ledger,
        private readonly AiAuditRecorder $audit,
    ) {}

    /**
     * @param  array{message:string, locale?:string, data_categories?:list<string>, scope?:array{branch_ids?:list<string>, warehouse_ids?:list<string>}}  $input  مُتحقَّق منه.
     * @return array<string,mixed>
     * @throws AiAssistantDenied
     */
    public function handle(User $requester, array $input, ?string $idempotencyKey = null): array
    {
        $requestId = (string) Str::uuid();
        $tenantId = (string) $requester->tenant_id;
        $actorId = (string) $requester->getKey();
        $categories = $input['data_categories'] ?? [AiAssistantDataCategory::ASSISTANT_MESSAGES];
        $branchIds = $input['scope']['branch_ids'] ?? [];
        $warehouseIds = $input['scope']['warehouse_ids'] ?? [];
        $locale = ($input['locale'] ?? 'ar') === 'en' ? 'en' : 'ar';
        $message = (string) ($input['message'] ?? '');

        $log = [
            'request_id' => $requestId,
            'tenant_id' => $tenantId,
            'actor_id' => $actorId,
            'data_categories' => $categories,
            'locale' => $locale,
            'message_chars' => mb_strlen($message),
            'branch_ids_requested' => count($branchIds),
            'warehouse_ids_requested' => count($warehouseIds),
            'tool_calls_planned' => 0,
            'tool_calls_executed' => 0,
        ];

        $request = null;
        $settled = false;
        $finalAudited = false;
        $usage = ['input_tokens' => 0, 'output_tokens' => 0, 'cost_micro_usd' => 0];
        $extra = [];

        try {
            $actor = $this->policy->authorize($actorId, $categories);
            $scope = $this->scopeGuard->resolve($actor, $branchIds, $warehouseIds);
            $provider = $this->provider();
            $log['provider'] = $extra['provider'] = $provider->name();
            $extra['model'] = $provider->model();

            $profile = AiAssistantPricing::profile($provider->name(), $provider->model())
                ?? throw AiAssistantDenied::for('pricing_unknown');

            $maxOutput = (int) config('ai_assistant.limits.max_output_tokens', 1024);
            $estimatedInput = AiAssistantPricing::estimateInputTokens($message);

            $request = $this->ledger->open(
                $tenantId,
                $actorId,
                $provider->name(),
                $provider->model(),
                $profile,
                $estimatedInput + $maxOutput,
                AiAssistantPricing::costMicroUsd($profile, $estimatedInput, $maxOutput),
                $idempotencyKey,
                $this->fingerprint($message, $locale, $categories, $branchIds, $warehouseIds),
            );
            $requestId = $log['request_id'] = $request->id;
            $extra['attempt'] = $request->attempt;
            $meta = [
                'message_chars' => $log['message_chars'],
                'branch_mode' => $scope['branch']['mode'], 'branch_count' => count($scope['branch']['ids']),
                'warehouse_mode' => $scope['warehouse']['mode'], 'warehouse_count' => count($scope['warehouse']['ids']),
                'billable' => $profile['billable'],
            ];

            // دائم وإلزامي قبل أي استدعاء: إن تعذّر يُحرَّر الحجز ويُمنع الاستدعاء.
            try {
                $this->audit->record($requestId, $tenantId, $actorId, 'request.started', 'allowed', 'reserved', $extra + ['meta' => $meta], required: true);
            } catch (Throwable $e) {
                report($e);
                $this->ledger->fail($request, ['input_tokens' => 0, 'output_tokens' => 0, 'cost_micro_usd' => 0], 'audit_unavailable');
                $settled = true;

                throw AiAssistantDenied::for('internal_error');
            }

            $reply = $this->callProvider($provider, $profile, $request, $message, $locale, $maxOutput, $tenantId, $actorId, $extra, $finalAudited, $settled);

            $usage = $this->usage($profile, $reply['usage']);
            $overrun = $profile['billable'] && (
                $usage['input_tokens'] + $usage['output_tokens'] > $request->reserved_tokens
                || $usage['cost_micro_usd'] > $request->reserved_cost_micro_usd
            );
            $this->ledger->complete($request, $usage);
            $settled = true;
            $extra += $usage;
            $meta['overrun'] = $overrun;

            $plannedCalls = $reply['tool_calls'];
            $log['tool_calls_planned'] = $meta['tool_calls_planned'] = count($plannedCalls);
            if (count($plannedCalls) > (int) config('ai_assistant.limits.max_tool_calls', 3)) {
                throw AiAssistantDenied::for('too_many_tool_calls');
            }

            $executed = [];
            foreach ($plannedCalls as $call) {
                $executed[] = $this->invokeTool($actorId, $call, $branchIds, $warehouseIds, $requestId, $tenantId, $extra);
                $log['tool_calls_executed'] = $meta['tool_calls_executed'] = count($executed);
            }

            $this->audit->record($requestId, $tenantId, $actorId, 'request.completed', 'allowed', 'ok', $extra + ['meta' => $meta]);
        } catch (AiAssistantDenied $denied) {
            if (! $finalAudited) {
                $this->audit->record($requestId, $tenantId, $actorId, 'request.denied', 'denied', $denied->reason, $extra + ['meta' => $meta ?? []]);
            }
            $this->log($log + ['outcome' => 'denied', 'reason' => $denied->reason]);
            $denied->requestId ??= $requestId;

            throw $denied;
        } catch (Throwable $e) {
            // غير متوقع (قاعدة بيانات …): لا تسرّب ولا حجز معلّق.
            report($e);
            if ($request !== null && ! $settled) {
                $this->ledger->fail($request, null, 'internal_error');
            }
            $this->audit->record($requestId, $tenantId, $actorId, 'request.failed', 'error', 'internal_error', $extra);
            $this->log($log + ['outcome' => 'denied', 'reason' => 'internal_error']);
            $denied = AiAssistantDenied::for('internal_error');
            $denied->requestId = $requestId;

            throw $denied;
        }

        $this->log($log + ['outcome' => 'allowed', 'reason' => 'ok']);

        return [
            'request_id' => $requestId,
            'status' => 'ok',
            'attempt' => $request->attempt,
            'provider' => $provider->name(),
            'locale' => $locale,
            'message' => ['role' => 'assistant', 'content' => $reply['content']],
            'data_categories' => $categories,
            'scope' => $scope,
            'usage' => ['input_tokens' => $usage['input_tokens'], 'output_tokens' => $usage['output_tokens']],
            'tool_calls' => $executed,
        ];
    }

    /** @throws AiAssistantDenied */
    private function provider(): AiAssistantProvider
    {
        // لا يُحلّ إلا `mock`. أي قيمة أخرى (حتى اسم مزوّد حقيقي مهيّأ في المنصة) تفشل مغلقةً: لا اتصال
        // شبكي ولا قراءة لأسرار المنصة في هذه المرحلة.
        if (config('ai_assistant.provider') !== 'mock') {
            throw AiAssistantDenied::for('provider_unavailable');
        }

        return $this->mockProvider;
    }

    /**
     * @param  array{billable:bool, input_micro_usd_per_1k:int, output_micro_usd_per_1k:int}  $profile
     * @param  array<string,mixed>  $extra
     * @return array{content:string, tool_calls:list<array{name:string, arguments:array<string,mixed>}>, usage:array{input_tokens:int, output_tokens:int}}
     * @throws AiAssistantDenied
     */
    private function callProvider(
        AiAssistantProvider $provider,
        array $profile,
        AiRequest $request,
        string $message,
        string $locale,
        int $maxOutput,
        string $tenantId,
        string $actorId,
        array $extra,
        bool &$finalAudited,
        bool &$settled,
    ): array {
        try {
            return $provider->respond(['message' => $message, 'locale' => $locale, 'max_output_tokens' => $maxOutput]);
        } catch (Throwable $e) {
            report($e);

            // استهلاك مُبلَّغ به إن وُجد يُحتسب كما هو؛ وإلا تُطبَّق سياسة الفشل على المحجوز.
            $reported = $e instanceof AiProviderException && $e->usage !== null ? $this->usage($profile, $e->usage) : null;
            $this->ledger->fail($request, $reported, 'provider_error');
            $settled = true;
            $this->audit->record(
                $request->id, $tenantId, $actorId, 'request.failed', 'error', 'provider_error',
                $extra + ($reported ?? []),
            );
            $finalAudited = true;

            throw AiAssistantDenied::for('internal_error');
        }
    }

    /**
     * @param  array{input_micro_usd_per_1k:int, output_micro_usd_per_1k:int}  $profile
     * @param  array{input_tokens:int, output_tokens:int}  $reported
     * @return array{input_tokens:int, output_tokens:int, cost_micro_usd:int}
     */
    private function usage(array $profile, array $reported): array
    {
        $in = max(0, (int) ($reported['input_tokens'] ?? 0));
        $out = max(0, (int) ($reported['output_tokens'] ?? 0));

        return ['input_tokens' => $in, 'output_tokens' => $out, 'cost_micro_usd' => AiAssistantPricing::costMicroUsd($profile, $in, $out)];
    }

    /**
     * استدعاء أداة واحد = تفويض كامل جديد. لا شيء من تفويض بداية الطلب يُعاد استعماله.
     *
     * @param  array{name:string, arguments:array<string,mixed>}  $call
     * @param  list<string>  $branchIds
     * @param  list<string>  $warehouseIds
     * @param  array<string,mixed>  $extra
     * @return array{tool:string, result:array<string,mixed>}
     * @throws AiAssistantDenied
     */
    private function invokeTool(string $actorId, array $call, array $branchIds, array $warehouseIds, string $requestId, string $tenantId, array $extra): array
    {
        $name = (string) ($call['name'] ?? '');
        // اسم مقترح من المزوّد لا يدخل التدقيق إلا إن كان رمزاً صالحاً.
        $auditName = preg_match('/^[a-z][a-z0-9_.]{0,79}$/', $name) === 1 ? $name : null;

        try {
            $tool = $this->tools->find($name);
            if ($tool === null) {
                throw AiAssistantDenied::for('tool_not_registered');
            }

            $fresh = $this->policy->authorize($actorId, [$tool->dataCategory()], $tool->requiredPermission());
            $scope = $this->scopeGuard->resolve($fresh, $branchIds, $warehouseIds);

            try {
                $result = $tool->execute($fresh, (array) ($call['arguments'] ?? []), $scope['branch'], $scope['warehouse']);
            } catch (AiAssistantDenied $denied) {
                throw $denied;
            } catch (Throwable $e) {
                report($e);

                throw AiAssistantDenied::for('internal_error');
            }
        } catch (AiAssistantDenied $denied) {
            // اسم الأداة المقترح من المزوّد لا يُسجَّل إلا إن كان رمزاً صالحاً (يفرضه المسجّل).
            $this->audit->record($requestId, $tenantId, $actorId, 'tool.denied', 'denied', $denied->reason, ($auditName === null ? [] : ['tool' => $auditName]) + $extra);

            throw $denied;
        }

        $this->audit->record($requestId, $tenantId, $actorId, 'tool.invoked', 'allowed', 'ok', ['tool' => $tool->name()] + $extra);

        return ['tool' => $tool->name(), 'result' => $result];
    }

    /** بصمة الطلب لكشف إعادة استعمال مفتاح التكرار مع طلب مختلف — HMAC لا نصّ. */
    private function fingerprint(string $message, string $locale, array $categories, array $branchIds, array $warehouseIds): string
    {
        sort($categories);
        sort($branchIds);
        sort($warehouseIds);

        return $this->ledger->hmac(json_encode([$message, $locale, $categories, $branchIds, $warehouseIds], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR));
    }

    /** @param array<string,mixed> $context */
    private function log(array $context): void
    {
        Log::info('ai_assistant.request', $context);
    }
}
