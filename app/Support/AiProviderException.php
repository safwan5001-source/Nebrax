<?php

namespace App\Support;

use RuntimeException;

/**
 * فشل مزوّد المساعد. قد يحمل الاستهلاك المُبلَّغ به إن عُرف (فيُحتسب كما هو)، وإلا يطبّق
 * `ai_assistant.budget.failure_charge`. رسالته لا تُكتب في أي سجل ولا تصل للعميل.
 */
final class AiProviderException extends RuntimeException
{
    /** @param array{input_tokens:int, output_tokens:int}|null $usage */
    public function __construct(string $message = 'provider failure', public readonly ?array $usage = null)
    {
        parent::__construct($message);
    }
}
