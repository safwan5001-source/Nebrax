<?php

namespace App\Services;

use App\Contracts\AiAssistantProvider;
use App\Contracts\AiExternalAssistantProvider;
use App\Models\AiRequest;
use App\Models\Tenant;
use App\Models\User;
use App\Support\AiAssistantDataCategory;
use App\Support\AiAssistantDenied;
use App\Support\AiAnswerGuard;
use App\Support\AiDocumentDigest;
use App\Support\AiAssistantPricing;
use App\Support\AiToolResultDigest;
use App\Support\Settings;
use App\Support\AiProviderException;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use InvalidArgumentException;
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
        // AI-07ب: مستند واحد يحدّده المستخدم صراحةً (UUID من شاشته). وجوده يضيف فئة نص المستند وصلاحية المركز إلى التفويض.
        $documentId = isset($input['document_id']) ? strtolower((string) $input['document_id']) : null;
        if ($documentId !== null) {
            $categories = array_values(array_unique([...$categories, AiAssistantDataCategory::ASSISTANT_MESSAGES, AiAssistantDataCategory::DOCUMENT_PROJECTED_TEXT]));
        }
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
        $documentContext = null;

        try {
            $actor = $this->policy->authorize($actorId, $categories, $documentId !== null ? 'documents.center.view' : null);
            $scope = $this->scopeGuard->resolve($actor, $branchIds, $warehouseIds);
            $provider = $this->provider();
            $external = $provider instanceof AiExternalAssistantProvider;
            $log['provider'] = $extra['provider'] = $provider->name();
            $extra['model'] = $provider->model();

            // مزوّد خارجي: لا إرسال بلا إقرار صريح من مالك المؤسسة بذلك (موافقات المرحلة التجريبية لا تنقلب إليه ضمنياً).
            if ($external && (Settings::group('ai_assistant_external', Tenant::query()->findOrFail($tenantId))['acknowledged'] ?? false) !== true) {
                throw AiAssistantDenied::for('external_provider_not_acknowledged');
            }

            if ($documentId !== null) {
                // لا مستند لمزوّد تجريبي (لا نموذج حقيقي يجيب)، ولا بلا مفتاح المنصة الثالث، ولا بلا إقرار المؤسسة المستقل.
                if (! $external) {
                    throw AiAssistantDenied::for('provider_unavailable');
                }
                if (config('ai_assistant.documents.external_send_enabled') !== true) {
                    throw AiAssistantDenied::for('external_documents_unavailable');
                }
                if ((Settings::group('ai_assistant_external', Tenant::query()->findOrFail($tenantId))['documents_acknowledged'] ?? false) !== true) {
                    throw AiAssistantDenied::for('external_documents_not_acknowledged');
                }
            }

            $profile = AiAssistantPricing::profile($provider->name(), $provider->model())
                ?? throw AiAssistantDenied::for('pricing_unknown');

            $maxOutput = (int) config('ai_assistant.limits.max_output_tokens', 1024);
            $estimatedInput = AiAssistantPricing::estimateInputTokens($message);
            // الخارجي نداءان كحدّ أقصى: يُحجز لهما معاً قبل أول استدعاء.
            $documentMaxTokens = (int) config('ai_assistant.documents.external_max_tokens', 4000);
            [$reserveIn, $reserveOut] = match (true) {
                $documentId !== null => $provider->documentReservationEstimate($estimatedInput, $documentMaxTokens, $maxOutput),
                $external => $provider->reservationEstimate($estimatedInput, $maxOutput),
                default => [$estimatedInput, $maxOutput],
            };

            $request = $this->ledger->open(
                $tenantId,
                $actorId,
                $provider->name(),
                $provider->model(),
                $profile,
                $reserveIn + $reserveOut,
                AiAssistantPricing::costMicroUsd($profile, $reserveIn, $reserveOut),
                $idempotencyKey,
                $this->fingerprint($message, $locale, $categories, $branchIds, $warehouseIds, $documentId),
                $documentId !== null ? 'assistant_document' : 'assistant',
            );
            $requestId = $log['request_id'] = $request->id;
            $extra['attempt'] = $request->attempt;
            $meta = [
                'message_chars' => $log['message_chars'],
                'branch_mode' => $scope['branch']['mode'], 'branch_count' => count($scope['branch']['ids']),
                'warehouse_mode' => $scope['warehouse']['mode'], 'warehouse_count' => count($scope['warehouse']['ids']),
                'billable' => $profile['billable'],
            ] + ($external ? ['external_ack' => true] : []) + ($documentId !== null ? ['document_external' => true, 'document_ack' => true] : []);

            // دائم وإلزامي قبل أي استدعاء: إن تعذّر يُحرَّر الحجز ويُمنع الاستدعاء.
            try {
                $this->audit->record($requestId, $tenantId, $actorId, 'request.started', 'allowed', 'reserved', $extra + ['meta' => $meta], required: true);
            } catch (Throwable $e) {
                report($e);
                $this->ledger->fail($request, ['input_tokens' => 0, 'output_tokens' => 0, 'cost_micro_usd' => 0], 'audit_unavailable');
                $settled = true;

                throw AiAssistantDenied::for('internal_error');
            }

            [$timezone, $today] = $this->tenantClock($tenantId);
            if ($documentId !== null) {
                // قراءة محلية بتفويض طازج (الحارس نفسه للقراءة الصريحة): مراجعة بشرية + تنقيح + نطاق مستأجر/فرع + حالة المستند.
                try {
                    $read = $this->invokeTool($actorId, ['name' => AiDocumentProjectionTool::NAME, 'arguments' => ['document_id' => $documentId]], $branchIds, $warehouseIds, $requestId, $tenantId, $extra, explicit: true);
                } catch (Throwable $e) {
                    // لم يُرسَل شيء إلى المزوّد: تُحرَّر المحجوزات بلا أي رسوم.
                    $this->ledger->fail($request, ['input_tokens' => 0, 'output_tokens' => 0, 'cost_micro_usd' => 0], $e instanceof AiAssistantDenied ? $e->reason : 'internal_error');
                    $settled = true;

                    throw $e;
                }
                $executed = [];
                $built = AiDocumentDigest::build($read['result'], $documentMaxTokens);
                if (! $built['fits']) {
                    // الأساس لا يتّسع في الحد الصارم: رفض آمن **قبل أي اتصال** وتُحرَّر المحجوزات بلا أي رسوم.
                    $this->ledger->fail($request, ['input_tokens' => 0, 'output_tokens' => 0, 'cost_micro_usd' => 0], 'document_too_large');
                    $settled = true;

                    throw AiAssistantDenied::for('document_too_large');
                }
                $meta['document_fields_sent'] = $built['fields'];
                $meta['document_lines_sent'] = $built['lines'];

                try {
                    $answered = $provider->answerDocument(['message' => $message, 'locale' => $locale, 'max_output_tokens' => $maxOutput, 'today' => $today, 'timezone' => $timezone], $built['digest']);
                } catch (Throwable $e) {
                    report($e);
                    $reported = $e instanceof AiProviderException && $e->usage !== null ? $this->usage($profile, $e->usage) : null;
                    $this->ledger->fail($request, $reported, 'provider_error');
                    $settled = true;
                    $this->audit->record($requestId, $tenantId, $actorId, 'request.failed', 'error', 'provider_error', $extra + ($reported ?? []));
                    $finalAudited = true;

                    throw AiAssistantDenied::for('internal_error');
                }

                $usage = $this->usage($profile, $answered['usage']);
                $this->settle($request, $profile, $usage, $settled, $extra, $meta);
                $answer = AiAnswerGuard::sanitize((string) $answered['content'], (int) config('ai_assistant.limits.answer_max_chars', 4000));
                // تأريض: كل رقم في الجواب يجب أن يكون من القيم المرسلة. ما لا يمكن التحقق منه يُحجب لا يُصلَح بصمت.
                $meta['grounded'] = $answer !== '' && AiAnswerGuard::isGrounded($answer, [$built['digest']]);
                $reply = [
                    'content' => $meta['grounded']
                        ? AiAnswerGuard::restoreNames($answer, $built['names'])
                        : ($locale === 'en'
                            ? 'I could not verify the figures in my written answer against the document values, so it was withheld. The document values are shown on the page.'
                            : 'تعذّر التحقق من الأرقام في صياغتي للجواب مقابل قيم المستند فحُجب. قيم المستند معروضة في الصفحة.'),
                ];
                $documentContext = ['ref' => $documentId, 'fields_sent' => $built['fields'], 'lines_sent' => $built['lines'], 'redacted' => $built['redacted']];
            } else {
                $reply = $this->callProvider($provider, $profile, $request, ['message' => $message, 'locale' => $locale, 'max_output_tokens' => $maxOutput, 'today' => $today, 'timezone' => $timezone], $tenantId, $actorId, $extra, $finalAudited, $settled);

                $usage = $this->usage($profile, $reply['usage']);
                $plannedCalls = $reply['tool_calls'];
                $log['tool_calls_planned'] = $meta['tool_calls_planned'] = count($plannedCalls);
                $tooMany = count($plannedCalls) > (int) config('ai_assistant.limits.max_tool_calls', 3);
                $executed = [];

                if ($external && $plannedCalls !== [] && ! $tooMany) {
                    // مزوّد خارجي اقترح أدوات: التنفيذ بتفويض طازج لكل أداة أولاً، ثم صياغة الجواب من ملخّصات محجوبة.
                    // التسوية تتأخر إلى ما بعد النداء الثاني؛ أي إخفاق قبله يُسوّي ما استُهلك فعلاً (النداء الأول).
                    try {
                        foreach ($plannedCalls as $call) {
                            $executed[] = $this->invokeTool($actorId, $call, $branchIds, $warehouseIds, $requestId, $tenantId, $extra, explicit: false);
                            $log['tool_calls_executed'] = $meta['tool_calls_executed'] = count($executed);
                        }
                    } catch (Throwable $e) {
                        $this->settle($request, $profile, $usage, $settled, $extra, $meta);

                        throw $e;
                    }

                    $digests = [];
                    $names = [];
                    $maxResultTokens = (int) config('ai_assistant.limits.tool_result_max_tokens', 3000);
                    foreach ($executed as $result) {
                        $built = AiToolResultDigest::build($result['result'], intdiv($maxResultTokens, max(1, count($executed))));
                        $digests[] = ['tool' => $result['tool'], 'digest' => $built['digest']];
                        $names += $built['names'];
                    }
                    $meta['composed'] = true;
                    $meta['results_digested'] = count($digests);

                    try {
                        $composed = $provider->compose(
                            ['message' => $message, 'locale' => $locale, 'max_output_tokens' => $maxOutput, 'today' => $today, 'timezone' => $timezone],
                            (array) ($reply['continuation'] ?? []),
                            $digests,
                        );
                    } catch (Throwable $e) {
                        report($e);
                        // النداء الأول استُهلك فعلاً ($usage). النداء الثاني فشل بلا استهلاك مُبلَّغ: يُطبَّق عليه `failure_charge` (قد يكون
                        // فُوتِر) — حصّته من الحجز تُحتسب مرة واحدة مع المقيس الفعلي، لا يُفقد ولا يُحتسب مرتين.
                        $reported = $this->usage($profile, ['input_tokens' => $usage['input_tokens'], 'output_tokens' => $usage['output_tokens']]);
                        if (config('ai_assistant.budget.failure_charge', 'reserved') !== 'none') {
                            [$secondIn, $secondOut] = $provider->secondCallReservation($estimatedInput, $maxOutput);
                            $reported['unmetered_tokens'] = $secondIn + $secondOut;
                            $reported['cost_micro_usd'] += AiAssistantPricing::costMicroUsd($profile, $secondIn, $secondOut);
                        }
                        $this->ledger->fail($request, $reported, 'provider_error');
                        $settled = true;
                        $this->audit->record($requestId, $tenantId, $actorId, 'request.failed', 'error', 'provider_error', $extra + $reported);
                        $finalAudited = true;

                        throw AiAssistantDenied::for('internal_error');
                    }

                    $usage = $this->usage($profile, $composed['usage']);
                    $this->settle($request, $profile, $usage, $settled, $extra, $meta);

                    $max = (int) config('ai_assistant.limits.answer_max_chars', 4000);
                    $answer = AiAnswerGuard::sanitize((string) $composed['content'], $max);
                    $meta['grounded'] = $answer !== '' && AiAnswerGuard::isGrounded($answer, array_column($digests, 'digest'));
                    $reply['content'] = $meta['grounded']
                        ? AiAnswerGuard::restoreNames($answer, $names)
                        : ($locale === 'en'
                            ? 'I could not verify the figures in my written answer, so it was withheld. The approved report figures are shown below.'
                            : 'تعذّر التحقق من الأرقام الواردة في صياغتي للجواب فحُجب. الأرقام المعتمدة معروضة في بطاقات النتائج أدناه.');
                } else {
                    $this->settle($request, $profile, $usage, $settled, $extra, $meta);
                    if ($tooMany) {
                        throw AiAssistantDenied::for('too_many_tool_calls');
                    }
                    foreach ($plannedCalls as $call) {
                        $executed[] = $this->invokeTool($actorId, $call, $branchIds, $warehouseIds, $requestId, $tenantId, $extra, explicit: false);
                        $log['tool_calls_executed'] = $meta['tool_calls_executed'] = count($executed);
                    }
                    if ($external) {
                        // الجواب المباشر من النموذج (بلا أدوات): نصّ بلا أرقام معتمدة، يُنظَّف فقط وتُرفض فيه أي أرقام مالية.
                        $answer = AiAnswerGuard::sanitize((string) $reply['content'], (int) config('ai_assistant.limits.answer_max_chars', 4000));
                        $meta['grounded'] = $answer !== '' && AiAnswerGuard::isGrounded($answer, []);
                        $reply['content'] = $meta['grounded'] ? $answer : ($locale === 'en'
                            ? 'I can only answer from the approved reports (income statement, receivables aging, payables aging). Please ask about one of them.'
                            : 'أستطيع الإجابة من التقارير المعتمدة فقط (قائمة الدخل، أعمار الذمم المدينة، أعمار الذمم الدائنة). اسأل عن أحدها.');
                    }
                }

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
            // نطاق **التفويض** المحلول لهذا الفاعل — ليس ما طُبّق على البيانات. ما طبّقته كل أداة فعلاً (ومنه أن
            // التقارير المالية بلا بُعد مخزن) في `tool_calls[].result.scope` وهو المرجع الوحيد لتفسير الأرقام.
            'scope_kind' => 'authorization',
            'scope' => $scope,
            'usage' => ['input_tokens' => $usage['input_tokens'], 'output_tokens' => $usage['output_tokens']],
            'tool_calls' => $executed,
        ] + ($documentContext === null ? [] : ['document' => $documentContext]);
    }

    /**
     * تشغيل **صريح** من المستخدم لأداة قراءة من السجل المغلق (AI-03) — بلا مزوّد ولا نموذج ولا إنفاق.
     *
     * يمرّ بالمسار الأمني نفسه لاستدعاء الأداة من المساعد حرفياً (`invokeTool`): المنصة ∩ المستأجر ∩ موافقة فئة
     * الأداة ∩ `ai.assistant.use` ∩ صلاحية الأداة (`reports.view`) بفاعل طازج، ثم رفض صريح للنطاق الممنوع،
     * ثم التحقق من المعطيات بمخطط الأداة المغلق، ثم التنفيذ بالفاعل الطازج مستخدِماً مصادَقاً، ثم تدقيق
     * وصفي. لا يتخطى شيئاً ليبدو «يعمل». الأرقام من `ReportService` كما هي، والنتيجة تعود للمستخدم وحده.
     *
     * @param  array<string,mixed>  $arguments
     * @param  array{scope?:array{branch_ids?:list<string>, warehouse_ids?:list<string>}}  $input
     * @return array<string,mixed>
     * @throws AiAssistantDenied
     */
    public function runTool(User $requester, string $toolName, array $arguments, array $input = []): array
    {
        $requestId = (string) Str::uuid();
        $tenantId = (string) $requester->tenant_id;
        $actorId = (string) $requester->getKey();
        $branchIds = $input['scope']['branch_ids'] ?? [];
        $warehouseIds = $input['scope']['warehouse_ids'] ?? [];
        $log = [
            'request_id' => $requestId, 'tenant_id' => $tenantId, 'actor_id' => $actorId, 'tool' => $toolName,
            'branch_ids_requested' => count($branchIds), 'warehouse_ids_requested' => count($warehouseIds),
        ];

        try {
            $executed = $this->invokeTool($actorId, ['name' => $toolName, 'arguments' => $arguments], $branchIds, $warehouseIds, $requestId, $tenantId, ['provider' => 'none'], explicit: true);
        } catch (AiAssistantDenied $denied) {
            Log::info('ai_assistant.tool_run', $log + ['outcome' => 'denied', 'reason' => $denied->reason]);
            $denied->requestId ??= $requestId;

            throw $denied;
        }

        Log::info('ai_assistant.tool_run', $log + ['outcome' => 'allowed', 'reason' => 'ok']);

        return [
            'request_id' => $requestId,
            'status' => 'ok',
            // لا نطاق تفويض هنا: ما طُبّق فعلاً داخل `tool_calls[].result.scope` وهو المرجع الوحيد.
            'tool_calls' => [$executed],
        ];
    }

    /** @throws AiAssistantDenied */
    private function provider(): AiAssistantProvider
    {
        // `mock` (الافتراضي) أو `anthropic` (AI-07، عبر تكامل المنصة القائم وبوابة الشبكة وكل ضوابطها). أي قيمة أخرى
        // تفشل مغلقةً: لا اتصال شبكي ولا قراءة لأسرار المنصة.
        return match (config('ai_assistant.provider')) {
            'mock' => $this->mockProvider,
            'anthropic' => tap(app(AnthropicAssistantProvider::class), static fn (AnthropicAssistantProvider $p) => $p->assertReady()),
            default => throw AiAssistantDenied::for('provider_unavailable'),
        };
    }

    /**
     * تسوية الطلب بالاستهلاك الفعلي (مرة واحدة). `overrun` = تجاوز الاستهلاك ما حُجز لطلب قابل للفوترة.
     *
     * @param  array{billable:bool}  $profile
     * @param  array{input_tokens:int, output_tokens:int, cost_micro_usd:int}  $usage
     * @param  array<string,mixed>  $extra
     * @param  array<string,mixed>  $meta
     */
    private function settle(AiRequest $request, array $profile, array $usage, bool &$settled, array &$extra, array &$meta): void
    {
        $meta['overrun'] = $profile['billable'] && (
            $usage['input_tokens'] + $usage['output_tokens'] > $request->reserved_tokens
            || $usage['cost_micro_usd'] > $request->reserved_cost_micro_usd
        );
        $this->ledger->complete($request, $usage);
        $settled = true;
        $extra += $usage;
    }

    /**
     * @param  array{billable:bool, input_micro_usd_per_1k:int, output_micro_usd_per_1k:int}  $profile
     * @param  array{message:string, locale:string, max_output_tokens:int, today:string, timezone:string}  $input
     * @param  array<string,mixed>  $extra
     * @return array{content:string, tool_calls:list<array{name:string, arguments:array<string,mixed>}>, usage:array{input_tokens:int, output_tokens:int}}
     * @throws AiAssistantDenied
     */
    private function callProvider(
        AiAssistantProvider $provider,
        array $profile,
        AiRequest $request,
        array $input,
        string $tenantId,
        string $actorId,
        array $extra,
        bool &$finalAudited,
        bool &$settled,
    ): array {
        try {
            return $provider->respond($input);
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
    private function invokeTool(string $actorId, array $call, array $branchIds, array $warehouseIds, string $requestId, string $tenantId, array $extra, bool $explicit): array
    {
        $name = (string) ($call['name'] ?? '');
        // اسم مقترح من المزوّد لا يدخل التدقيق إلا إن كان رمزاً صالحاً.
        $auditName = preg_match('/^[a-z][a-z0-9_.]{0,79}$/', $name) === 1 ? $name : null;

        try {
            $tool = $this->tools->find($name);
            if ($tool === null) {
                throw AiAssistantDenied::for('tool_not_registered');
            }
            // أداة صريحة الاستدعاء (AI-04) لا يخطّط لها المزوّد ولا يختار وسائطها: تُعامَل كغير مسجَّلة هنا.
            if (! $explicit && $tool instanceof \App\Contracts\AiExplicitInvocationOnly) {
                throw AiAssistantDenied::for('tool_not_registered');
            }

            $fresh = $this->policy->authorize($actorId, [$tool->dataCategory()], $tool->requiredPermission());
            $scope = $this->scopeGuard->resolve($fresh, $branchIds, $warehouseIds);

            // أداة بلا بُعد مخزن لا تتجاهل مخازن طُلبت صراحةً بصمت.
            if (! $tool->supportsWarehouseScope() && $scope['warehouse']['mode'] === 'selected') {
                throw AiAssistantDenied::for('scope_not_supported');
            }

            // التحقق من المعطيات بعد التفويض (لا يعرف غير المخوَّل مخطط الأداة).
            try {
                $arguments = $tool->validate((array) ($call['arguments'] ?? []));
            } catch (InvalidArgumentException) {
                throw AiAssistantDenied::for('invalid_tool_arguments');
            }

            // الفاعل الطازج هو «المستخدم المصادَق» طوال التنفيذ: خدمات التقارير تقرأ نطاق الفروع من
            // `auth()->user()`، فلا يجوز أن ترى نسخة قديمة منه.
            $guard = Auth::guard();
            $previous = $guard->user();
            $guard->setUser($fresh);

            try {
                $result = $tool->execute($fresh, $arguments, $scope['branch'], $scope['warehouse']);
            } catch (AiAssistantDenied $denied) {
                throw $denied;
            } catch (Throwable $e) {
                report($e);

                throw AiAssistantDenied::for('internal_error');
            } finally {
                if ($previous !== null) {
                    $guard->setUser($previous);
                }
            }
        } catch (AiAssistantDenied $denied) {
            // اسم الأداة المقترح من المزوّد لا يُسجَّل إلا إن كان رمزاً صالحاً (يفرضه المسجّل).
            $this->audit->record($requestId, $tenantId, $actorId, 'tool.denied', 'denied', $denied->reason, ($auditName === null ? [] : ['tool' => $auditName]) + $extra);

            throw $denied;
        }

        $this->audit->record($requestId, $tenantId, $actorId, 'tool.invoked', 'allowed', 'ok', ['tool' => $tool->name(), 'meta' => $tool->auditMeta($result)] + $extra);

        return ['tool' => $tool->name(), 'result' => $result];
    }

    /** @return array{0:string, 1:string} [المنطقة الزمنية للمستأجر، تاريخ اليوم Y-m-d بتوقيته]. */
    private function tenantClock(string $tenantId): array
    {
        $zone = (string) (Tenant::query()->whereKey($tenantId)->value('timezone') ?: 'Asia/Riyadh');
        if (! in_array($zone, timezone_identifiers_list(), true)) {
            $zone = 'Asia/Riyadh';
        }

        return [$zone, now($zone)->format('Y-m-d')];
    }

    /** بصمة الطلب لكشف إعادة استعمال مفتاح التكرار مع طلب مختلف — HMAC لا نصّ. */
    private function fingerprint(string $message, string $locale, array $categories, array $branchIds, array $warehouseIds, ?string $documentId = null): string
    {
        sort($categories);
        sort($branchIds);
        sort($warehouseIds);

        return $this->ledger->hmac(json_encode([$message, $locale, $categories, $branchIds, $warehouseIds] + ($documentId === null ? [] : [5 => $documentId]), JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR));
    }

    /** @param array<string,mixed> $context */
    private function log(array $context): void
    {
        Log::info('ai_assistant.request', $context);
    }
}
