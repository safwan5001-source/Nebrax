<?php

namespace App\Support\Communications;

/**
 * AWJ-COMMS-02-B — ما يعيده الإدراج للمستهلك. قيمة نقيّة (لا نموذج Eloquent) فلا تُسرَّب حمولة ولا بصمة ولا عنوان.
 * `Replayed` تعني «الرسالة القائمة نفسها» بأي حالة هي عليها الآن (قد تكون أُرسلت)؛ لا إعادة إدراج ولا إرسال ثانٍ.
 */
final readonly class EnqueueResult
{
    public function __construct(
        public string $messageId,
        public EnqueueOutcome $outcome,
        public DeliveryStatus $status,
    ) {
    }

    public function wasCreated(): bool
    {
        return $this->outcome === EnqueueOutcome::Created;
    }
}
