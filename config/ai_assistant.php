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
    ],
];
