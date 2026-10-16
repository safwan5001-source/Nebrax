<?php

namespace App\Services;

use App\Contracts\AiAssistantProvider;
use App\Models\User;
use App\Support\AiAssistantDataCategory;
use App\Support\AiAssistantDenied;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Throwable;

/**
 * بوابة المساعد الذكي (AWJ Intelligence، AI-01) — تنسيقٌ فقط، بلا بيانات ولا شبكة.
 *
 * التسلسل الثابت لكل طلب، وأي رفض يوقفه قبل بناء أي prompt:
 *   ١. تفويض (المنصة ∩ المستأجر ∩ الفاعل الطازج ∩ فئات البيانات)
 *   ٢. نطاق الفرع/المخزن — رفض صريح للممنوع
 *   ٣. المزوّد (`mock` وحده؛ غيره يفشل مغلقاً)
 *   ٤. لكل استدعاء أداة يقترحه المزوّد: سجلّ مغلق ← إعادة تفويض كاملة بفاعل طازج
 *      ← إعادة حلّ النطاق ← تنفيذ. السجل فارغ في AI-01، فكل اقتراح يُرفض.
 *
 * المستأجر والفاعل يأتيان من السياق الموثوق فقط. التدقيق: سطر سجلّ بيانات وصفية
 * (معرّفات، رمز النتيجة، أعداد) — لا نصّ رسالة ولا ردّ ولا أي سرّ.
 */
class AiAssistantGateway
{
    public function __construct(
        private readonly AiAssistantPolicy $policy,
        private readonly AiAssistantScopeGuard $scopeGuard,
        private readonly AiAssistantToolRegistry $tools,
        private readonly MockAiAssistantProvider $mockProvider,
    ) {}

    /**
     * @param  array{message:string, locale?:string, data_categories?:list<string>, scope?:array{branch_ids?:list<string>, warehouse_ids?:list<string>}}  $input  مُتحقَّق منه.
     * @return array<string,mixed>
     * @throws AiAssistantDenied
     */
    public function handle(User $requester, array $input): array
    {
        $requestId = (string) Str::uuid();
        $categories = $input['data_categories'] ?? [AiAssistantDataCategory::ASSISTANT_MESSAGES];
        $branchIds = $input['scope']['branch_ids'] ?? [];
        $warehouseIds = $input['scope']['warehouse_ids'] ?? [];
        $locale = ($input['locale'] ?? 'ar') === 'en' ? 'en' : 'ar';

        $audit = [
            'request_id' => $requestId,
            'tenant_id' => $requester->tenant_id,
            'actor_id' => $requester->getKey(),
            'data_categories' => $categories,
            'locale' => $locale,
            'message_chars' => mb_strlen((string) ($input['message'] ?? '')),
            'branch_ids_requested' => count($branchIds),
            'warehouse_ids_requested' => count($warehouseIds),
            'tool_calls_planned' => 0,
            'tool_calls_executed' => 0,
        ];

        try {
            $actor = $this->policy->authorize((string) $requester->getKey(), $categories);
            $scope = $this->scopeGuard->resolve($actor, $branchIds, $warehouseIds);
            $provider = $this->provider();

            $audit['provider'] = $provider->name();
            $reply = $this->respond($provider, $input['message'], $locale);

            $plannedCalls = $reply['tool_calls'];
            $audit['tool_calls_planned'] = count($plannedCalls);
            if (count($plannedCalls) > (int) config('ai_assistant.limits.max_tool_calls', 3)) {
                throw AiAssistantDenied::for('too_many_tool_calls');
            }

            $executed = [];
            foreach ($plannedCalls as $call) {
                $executed[] = $this->invokeTool((string) $requester->getKey(), $call, $branchIds, $warehouseIds);
                $audit['tool_calls_executed'] = count($executed);
            }
        } catch (AiAssistantDenied $denied) {
            $this->audit($audit + ['outcome' => 'denied', 'reason' => $denied->reason]);
            $denied->requestId = $requestId;

            throw $denied;
        }

        $this->audit($audit + ['outcome' => 'allowed', 'reason' => 'ok']);

        return [
            'request_id' => $requestId,
            'status' => 'ok',
            'provider' => $provider->name(),
            'locale' => $locale,
            'message' => ['role' => 'assistant', 'content' => $reply['content']],
            'data_categories' => $categories,
            'scope' => $scope,
            'tool_calls' => $executed,
        ];
    }

    /** @throws AiAssistantDenied */
    private function provider(): AiAssistantProvider
    {
        // لا يُحلّ إلا `mock`. أي قيمة أخرى (حتى اسم مزوّد حقيقي مهيّأ في المنصة)
        // تفشل مغلقةً: لا اتصال شبكي ولا قراءة لأسرار المنصة في هذه المرحلة.
        if (config('ai_assistant.provider') !== 'mock') {
            throw AiAssistantDenied::for('provider_unavailable');
        }

        return $this->mockProvider;
    }

    /**
     * @return array{content:string, tool_calls:list<array{name:string, arguments:array<string,mixed>}>}
     * @throws AiAssistantDenied
     */
    private function respond(AiAssistantProvider $provider, string $message, string $locale): array
    {
        try {
            return $provider->respond(['message' => $message, 'locale' => $locale]);
        } catch (Throwable $e) {
            report($e);

            throw AiAssistantDenied::for('internal_error');
        }
    }

    /**
     * استدعاء أداة واحد = تفويض كامل جديد. لا شيء من تفويض بداية الطلب يُعاد استعماله.
     *
     * @param  array{name:string, arguments:array<string,mixed>}  $call
     * @param  list<string>  $branchIds
     * @param  list<string>  $warehouseIds
     * @return array{tool:string, result:array<string,mixed>}
     * @throws AiAssistantDenied
     */
    private function invokeTool(string $actorId, array $call, array $branchIds, array $warehouseIds): array
    {
        $tool = $this->tools->find((string) ($call['name'] ?? ''));
        if ($tool === null) {
            throw AiAssistantDenied::for('tool_not_registered');
        }

        $fresh = $this->policy->authorize($actorId, [$tool->dataCategory()], $tool->requiredPermission());
        $scope = $this->scopeGuard->resolve($fresh, $branchIds, $warehouseIds);

        try {
            $result = $tool->execute($fresh, (array) ($call['arguments'] ?? []), $scope['branch'], $scope['warehouse']);
        } catch (Throwable $e) {
            report($e);

            throw AiAssistantDenied::for('internal_error');
        }

        return ['tool' => $tool->name(), 'result' => $result];
    }

    /** @param array<string,mixed> $context */
    private function audit(array $context): void
    {
        Log::info('ai_assistant.request', $context);
    }
}
