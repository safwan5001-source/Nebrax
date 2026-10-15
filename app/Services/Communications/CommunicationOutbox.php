<?php

namespace App\Services\Communications;

use App\Models\CommunicationMessage;
use App\Support\Communications\CommunicationsPolicyException;
use App\Support\Communications\CommunicationsStorageException;
use App\Support\Communications\DeliveryStatus;
use App\Support\Communications\EnqueueOutcome;
use App\Support\Communications\EnqueueResult;
use App\Support\Communications\IdempotencyConflictException;
use App\Support\Communications\IdempotencyUnverifiableException;
use App\Support\Communications\MessageClassification;
use App\Support\Communications\MessageIntent;
use App\Support\Communications\TenantMismatchException;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * AWJ-COMMS-02-B — الإدراج الآمن المتكرّر-الأمان (Idempotent Enqueue) لنيّات الاتصال. **لا إرسال هنا** ولا مزوّد ولا شبكة.
 *
 * الضمانات:
 *  - المستأجر من `TenantContext` الموثوق فقط؛ `MessageIntent::tenantId` يُتحقَّق أنه يطابقه (وإلا `TenantMismatchException`).
 *  - **القيد الفريد `(tenant_id, idempotency_hash)` هو الحكم النهائي** في التزامن؛ الفحص المسبق تحسينٌ لا ضمان. الإدراج
 *    داخل savepoint فلا يُجهَض تعامل PostgreSQL المحيط عند التعارض.
 *  - مطابقة (نفس المفتاح + نفس المحتوى) ⇒ `Replayed` بالرسالة القائمة. محتوى مختلف ⇒ `IdempotencyConflictException`.
 *    صف قديم بلا بصمة ⇒ `IdempotencyUnverifiableException` (لا يُفترض تطابق). فشل قاعدة بيانات غير التفرّد ⇒
 *    `CommunicationsStorageException` (لا يتحوّل إلى تعارض).
 *  - OTP: صف «سجل فقط» بلا حمولة ولا عنوان خام، `max_attempts = 1` (والقاعدة تفرضه)؛ لا جسر OTP هنا.
 *  - غير OTP: الحمولة `{address, variables}` مشفَّرة (cast النموذج). `recipient_masked` وحده يظهر في الأعمدة.
 *  - `marketing` مرفوض حتى وجود سجل موافقات (D3/D4). مفتاح التكرار لا يجوز أن يحمل عنوان المستلم (أو رمز OTP).
 *
 * معاملة قصيرة واحدة (إدراج فقط)؛ الإدراج ضمن معاملة الأعمال المحيطة إن وُجدت ليلتزم معها.
 */
final class CommunicationOutbox
{
    private const MAX_TTL_SECONDS = 2592000; // 30 يوماً

    private const MAX_ATTEMPTS_CEILING = 10;

    public function __construct(
        private readonly TenantContext $tenantContext,
        private readonly RequestFingerprinter $fingerprinter,
    ) {
    }

    public static function make(): self
    {
        return new self(app(TenantContext::class), new RequestFingerprinter(HmacKeyring::fromConfig()));
    }

    public function enqueue(MessageIntent $intent): EnqueueResult
    {
        $tenantId = $this->trustedTenantId($intent);
        $this->assertKeyHoldsNoRecipientData($intent);
        [$ttlSeconds, $maxAttempts] = $this->policyFor($intent->classification);

        $hash = $intent->idempotencyHash();

        // مسار سريع للتكرار المعتاد (تحسين فقط؛ التزامن يحسمه القيد الفريد أدناه).
        try {
            $existing = $this->findByHash($tenantId, $hash);
        } catch (QueryException $e) {
            throw $this->storageFailure($tenantId, $e);
        }
        if ($existing !== null) {
            return $this->replay($existing, $intent);
        }

        [$fingerprint, $keyVersion] = $this->fingerprinter->fingerprintForNewMessage($intent);
        $now = now();
        $isOtp = $intent->classification === MessageClassification::Otp;

        $attributes = [
            'tenant_id' => $tenantId,
            'channel' => $intent->channel()->value,
            'classification' => $intent->classification->value,
            'template_key' => $intent->templateKey,
            'source' => $intent->source,
            'idempotency_hash' => $hash,
            'recipient_masked' => $intent->recipient->masked(),
            // OTP: لا حمولة ولا عنوان خام أبداً (CHECK/Trigger في القاعدة + حارس النموذج).
            'payload_encrypted' => $isOtp ? null : ['address' => $intent->recipient->address, 'variables' => $intent->variables],
            'status' => DeliveryStatus::Queued->value,
            'attempt_count' => 0,
            'max_attempts' => $maxAttempts,
            'next_attempt_at' => $now,
            'expires_at' => $now->copy()->addSeconds($ttlSeconds),
            'request_fingerprint' => $fingerprint,
            'hash_key_version' => $keyVersion,
        ];

        try {
            $message = DB::transaction(static fn () => CommunicationMessage::create($attributes));
        } catch (QueryException $e) {
            // تعارض تفرّد ⇒ الصف موجود (سباق): نقارنه. أي فشل آخر ⇒ لا صف ⇒ خطأ تخزين لا تعارض.
            // فشل البحث نفسه (قاعدة غير متاحة باستمرار) يُعامَل خطأ تخزين أيضاً فلا يتسرّب QueryException خاماً.
            try {
                $existing = $this->findByHash($tenantId, $hash);
            } catch (QueryException $lookupFailure) {
                // يُسجَّل SQLSTATE الاستعلام الذي أفشل الاسترداد (قد يكون انقطاعاً) لا تعارض التفرّد الأصلي.
                throw $this->storageFailure($tenantId, $lookupFailure);
            }

            if ($existing === null) {
                throw $this->storageFailure($tenantId, $e);
            }

            return $this->replay($existing, $intent);
        }

        return new EnqueueResult($message->id, EnqueueOutcome::Created, DeliveryStatus::from($message->status));
    }

    /** سجلّ مُعقَّم (مستأجر + SQLSTATE فقط) واستثناء ثابت بلا سلسلة سابقة: لا حمولة ولا عنوان ولا bindings. */
    private function storageFailure(string $tenantId, QueryException $e): CommunicationsStorageException
    {
        Log::error('communications.enqueue.storage_failure', ['tenant_id' => $tenantId, 'sqlstate' => (string) $e->getCode()]);

        return new CommunicationsStorageException('Communication message storage failed.');
    }

    private function trustedTenantId(MessageIntent $intent): string
    {
        if (! $this->tenantContext->has() || $this->tenantContext->id() !== $intent->tenantId) {
            throw new TenantMismatchException('The message intent does not match the trusted tenant context.');
        }

        return $this->tenantContext->id();
    }

    /** @return array{0: int, 1: int} [ttl بالثواني، أقصى محاولات] */
    private function policyFor(MessageClassification $classification): array
    {
        $policy = config("communications.policy.{$classification->value}");
        if (! is_array($policy)) {
            throw new CommunicationsPolicyException('This message classification is not enabled for enqueue.');
        }

        $ttl = $policy['ttl_seconds'] ?? null;
        $attempts = $classification === MessageClassification::Otp ? 1 : ($policy['max_attempts'] ?? null);
        if (! is_int($ttl) || $ttl < 1 || $ttl > self::MAX_TTL_SECONDS
            || ! is_int($attempts) || $attempts < 1 || $attempts > self::MAX_ATTEMPTS_CEILING) {
            throw new CommunicationsPolicyException('The communications policy for this classification is invalid.');
        }

        return [$ttl, $attempts];
    }

    /** مفتاح التكرار يُخزَّن مجزَّأً بلا مفتاح سرّي؛ يجب ألا يحمل بيانات شخصية (عنوان المستلم، أو رمز OTP). */
    private function assertKeyHoldsNoRecipientData(MessageIntent $intent): void
    {
        $key = strtolower($intent->idempotencyKey);
        $address = strtolower($intent->recipient->address);
        $embeds = str_contains($key, $address)
            || ($intent->channel()->usesPhoneAddress() && str_contains($key, ltrim($address, '+')));

        if (! $embeds && $intent->classification === MessageClassification::Otp) {
            // الرمز يُستخرج من تجزئة بلا مفتاح بتعداد فضائه الصغير: نرفض أي قيمة متغير تظهر في المفتاح — كجزءٍ كامل بين
            // الفواصل (أي طول: رمز من 3 خانات مثلاً) أو كسلسلة فرعية من 3 محارف فأكثر. قيمة بحرف/حرفين لا تُرفض
            // كسلسلة فرعية (تطابقٌ عرضيّ يرفض كل مفتاح)، لكنها تُرفض إن كانت جزءاً كاملاً.
            $segments = preg_split('/[._:-]/', $key) ?: [];
            foreach ($intent->variables as $value) {
                $needle = strtolower($value);
                if ($needle !== '' && (in_array($needle, $segments, true) || (strlen($needle) >= 3 && str_contains($key, $needle)))) {
                    $embeds = true;
                    break;
                }
            }
        }

        if ($embeds) {
            throw new CommunicationsPolicyException('The idempotency key must not embed recipient or one-time-code data.');
        }
    }

    private function findByHash(string $tenantId, string $hash): ?CommunicationMessage
    {
        return CommunicationMessage::query()
            ->where('tenant_id', $tenantId)
            ->where('idempotency_hash', $hash)
            ->first();
    }

    private function replay(CommunicationMessage $existing, MessageIntent $intent): EnqueueResult
    {
        $storedFingerprint = $existing->request_fingerprint;
        $storedVersion = $existing->hash_key_version;

        if ($storedFingerprint === null || $storedVersion === null) {
            throw new IdempotencyUnverifiableException('The existing message cannot be verified against this request.');
        }

        if (! $this->fingerprinter->matches($intent, (int) $storedVersion, trim((string) $storedFingerprint))) {
            throw new IdempotencyConflictException('The idempotency key was already used with a different request.');
        }

        return new EnqueueResult($existing->id, EnqueueOutcome::Replayed, DeliveryStatus::from($existing->status));
    }
}
