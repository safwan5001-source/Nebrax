<?php

namespace App\Support;

use App\Models\PaymentAttempt;

/** نتيجة تطبيق لقطة مزوّد: `applied=false` ⇒ لقطة متأخرة/مكررة تُجوهلت ولا أثر لها (السبب في `ignoredReason`). */
final class PaymentAttemptTransitionResult
{
    public function __construct(
        public readonly PaymentAttempt $attempt,
        public readonly bool $applied,
        public readonly ?string $ignoredReason = null,
    ) {}
}
