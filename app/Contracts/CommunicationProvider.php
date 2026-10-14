<?php

namespace App\Contracts;

use App\Support\Communications\DispatchResult;
use App\Support\Communications\MessageIntent;
use App\Support\Communications\ProviderCapabilities;

/**
 * ADR-COMMS-01 — حدّ المحوّل (Adapter) بين منصة الاتصالات وأي مزوّد فعلي. محايد للمزوّد والقناة:
 * محوّل Unifonic أو Twilio أو Resend أو FCM يطبّقه بلا أن تعرف الوحدات المستهلكة شيئاً عنه.
 *
 * عقد صارم:
 *  - `send()` **لا يرمي** لأخطاء المزوّد؛ يعيد `DispatchResult` مصنَّفاً. طلبٌ خارج `capabilities()` يعيد `unsupported`.
 *  - التنفيذ لا يسجّل المتغيرات ولا الرموز ولا الأسرار، ويستعمل `MessageIntent::describe()` وحده في أي نص.
 *  - لا اتصال شبكي إلا بعد بوابة الشبكة والجاهزية (شرائح لاحقة)؛ هذه الشريحة بلا أي محوّل حقيقي.
 *  - بيانات اعتماد المستأجر وتجربة الاتصال (`testConnection`) خارج العقد حتى شريحة حسابات المزوّد.
 */
interface CommunicationProvider
{
    /** مفتاح ثابت للمزوّد (مثل `fake-sms`)؛ ليس مرجع حساب ولا سرّاً. */
    public function key(): string;

    public function capabilities(): ProviderCapabilities;

    public function send(MessageIntent $intent): DispatchResult;
}
