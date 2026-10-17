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

    // Only `mock` is implemented. Any other value fails closed with
    // `provider_unavailable` — it can never route to a network provider.
    'provider' => env('AI_ASSISTANT_PROVIDER', 'mock'),

    'limits' => [
        // Bounded request contract (characters, not bytes).
        'message_max_chars' => 2000,
        // Upper bound on scope identifiers carried by one request.
        'scope_max_ids' => 10,
        // Upper bound on tool invocations the provider may plan for one turn.
        'max_tool_calls' => 3,
        // Hard ceiling on completion tokens per provider call; also the reservation size (output side).
        'max_output_tokens' => 1024,
    ],

    /*
    | Document projections (AI-04). A SECOND platform switch, independent of `enabled`: the category
    | `document_projected_text` is unavailable (cannot be granted, cannot be read) unless this is an explicit
    | `true`. Tenant consent stays per-tenant and default-off; this flag never grants anything by itself.
    | The bounds apply to the projection returned to the authorized user (it is never sent to a provider).
    */
    'documents' => [
        'enabled' => filter_var(env('AI_ASSISTANT_DOCUMENTS_ENABLED', false), FILTER_VALIDATE_BOOLEAN),
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
    ],

    // Retention for durable audit events and request records (days). The prune command enforces a floor
    // of 30 days; shortening below it requires a code change, not configuration.
    'audit' => [
        'retention_days' => 400,
    ],
];
