<?php

/*
|--------------------------------------------------------------------------
| AWJ Intelligence — AI-01 Secure Gateway (mock-only)
|--------------------------------------------------------------------------
|
| Platform-level kill switch and hard limits for the assistant gateway.
| Everything defaults to OFF/closed. The gateway never reads provider secrets
| and never opens a network connection in this phase: the only supported
| provider is the deterministic in-process `mock`. Real providers (and their
| encrypted, platform-owned connection settings) are a later, separately
| approved step.
|
*/

return [
    // Platform kill switch. Anything other than an explicit `true` keeps the
    // gateway uncallable for every tenant.
    'enabled' => filter_var(env('AI_ASSISTANT_ENABLED', false), FILTER_VALIDATE_BOOLEAN),

    // `mock` (default) | `anthropic` (AI-07). `anthropic` reuses the platform integration (encrypted key + model chosen by
    // the platform administrator) AND still needs the global provider-network switch, per-tenant acknowledgement,
    // consent, a known price and budgets. Anything else fails closed with `provider_unavailable`.
    'provider' => env('AI_ASSISTANT_PROVIDER', 'mock'),

    // AI-07: مفتاح الاتصال الخارجي للمساعد — **مستقل** عن `DOCUMENT_AI_PROVIDER_NETWORK_ENABLED` (استخراج المستندات).
    // كلاهما مغلق افتراضياً ولا يفتح أحدهما الآخر؛ يمكن تشغيلهما معاً بمفتاحين صريحين.
    'external_network_enabled' => filter_var(env('AI_ASSISTANT_EXTERNAL_NETWORK_ENABLED', false), FILTER_VALIDATE_BOOLEAN),

    'limits' => [
        // Bounded request contract (characters, not bytes).
        'message_max_chars' => 2000,
        // Upper bound on scope identifiers carried by one request.
        'scope_max_ids' => 10,
        // Upper bound on tool invocations the provider may plan for one turn.
        'max_tool_calls' => 3,
        // Hard ceiling on completion tokens per provider call; also the reservation size (output side).
        'max_output_tokens' => 1024,
        // AI-07 (external provider only): the minimised tool results sent back to the model are capped at this many
        // estimated tokens, and the budget reservation for the second call is sized from it.
        'tool_result_max_tokens' => 3000,
        // Longest model answer kept (characters) after sanitising.
        'answer_max_chars' => 4000,
    ],

    /*
    | Document projections (AI-04). A SECOND platform switch, independent of `enabled`: the category
    | `document_projected_text` is unavailable (cannot be granted, cannot be read) unless this is an explicit
    | `true`. Tenant consent stays per-tenant and default-off; this flag never grants anything by itself.
    | The bounds apply to the projection returned to the authorized user (it is never sent to a provider).
    */
    'documents' => [
        'enabled' => filter_var(env('AI_ASSISTANT_DOCUMENTS_ENABLED', false), FILTER_VALIDATE_BOOLEAN),
        // AI-07ب: مفتاح منصة **ثالث ومستقل** لإرسال القيم المراجَعة والمنقَّحة إلى المزوّد الخارجي (الإجابة عن أسئلة مستند).
        // تفعيل القراءة المحلية أعلاه لا يفتح هذا المسار؛ كلاهما مغلق افتراضياً.
        'external_send_enabled' => filter_var(env('AI_ASSISTANT_DOCUMENTS_EXTERNAL_ENABLED', false), FILTER_VALIDATE_BOOLEAN),
        // سقف رموز ملخّص المستند المرسَل للنموذج (يُقصّ قبل الإرسال؛ ويحدد حجم الحجز).
        'external_max_tokens' => 4000,
        'max_fields' => 24,
        'max_lines' => 50,
        'max_warnings' => 10,
        'max_text_chars' => 200,
    ],

    /*
    | Spend control (AI-02A). Caps live in `ai_budgets` and are explicit: a billable request with no
    | global AND tenant budget row for the current UTC month is refused. There is no unlimited default.
    | Units: tokens, and micro-USD (1 USD = 1,000,000).
    */
    'budget' => [
        // A reservation older than this is treated as an abandoned request and settled by the reaper.
        'reservation_ttl_seconds' => 600,
        // What a failed / abandoned attempt costs when the provider reported no usage:
        //   reserved = the whole reservation (conservative; the call may have been billed)
        //   none     = nothing
        'failure_charge' => 'reserved',
        // AI-07: هل يدخل استخراج المستندات (Document Center) في **ميزانية الذكاء الاصطناعي نفسها**؟ سياسة تُضبط:
        // مطفأ افتراضياً (سلوك المؤسسات القائمة لا يتغيّر؛ الاستخراج يبقى محكوماً بحدود العمليات/الصفحات الشهرية).
        // عند التشغيل: حجز قبل كل استدعاء، وبلا سعر/ميزانية لا يُرسَل المستند. يُوصى بتشغيله عند تفعيل Anthropic.
        'meter_document_extraction' => filter_var(env('AI_ASSISTANT_METER_DOCUMENT_EXTRACTION', false), FILTER_VALIDATE_BOOLEAN),
    ],

    // تقدير الحجز لاستخراج مستند (متحفظ عمداً؛ التسوية بالاستهلاك الفعلي). المخرجات = max_tokens في عميل الاستخراج.
    'document_extraction' => [
        'input_tokens_per_page' => 6000,
        'overhead_tokens' => 3000,
        'max_output_tokens' => 4096,
    ],

    /*
    | Price table, micro-USD per 1,000 tokens, per provider and model. A provider/model with no entry
    | is refused (`pricing_unknown`) — never treated as free. `billable=false` is honoured for the
    | in-process `mock` provider ONLY; every other provider is always billable. No real provider is
    | resolvable in this phase, so no real prices are listed.
    */
    'pricing' => [
        'mock' => [
            'mock-1' => ['billable' => false, 'input_micro_usd_per_1k' => 0, 'output_micro_usd_per_1k' => 0],
        ],
        // AI-07: Anthropic prices are NEVER guessed in code. The owner supplies them (integer micro-USD per 1,000 tokens)
        // for the exact model id chosen in the platform integration, e.g.
        //   AI_ASSISTANT_ANTHROPIC_PRICING='{"<model-id>":{"input_micro_usd_per_1k":N,"output_micro_usd_per_1k":N}}'
        // Missing / malformed entries are ignored, so an unpriced model is refused (`pricing_unknown`), never free.
        'anthropic' => (static function (): array {
            $decoded = json_decode((string) env('AI_ASSISTANT_ANTHROPIC_PRICING', ''), true);

            return is_array($decoded) ? $decoded : [];
        })(),
    ],

    // Retention for durable audit events and request records (days). The prune command enforces a floor
    // of 30 days; shortening below it requires a code change, not configuration.
    'audit' => [
        'retention_days' => 400,
    ],
];
