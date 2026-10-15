<?php

namespace App\Support\Communications;

/** AWJ-COMMS-02-B — نتيجة إدراج نيّة: رسالة جديدة، أو إعادة مطابقة لرسالة قائمة بنفس المفتاح. */
enum EnqueueOutcome: string
{
    case Created = 'created';
    case Replayed = 'replayed';
}
