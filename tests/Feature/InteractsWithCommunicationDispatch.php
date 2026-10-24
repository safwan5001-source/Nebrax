<?php

namespace Tests\Feature;

use App\Models\CommunicationMessage;
use App\Services\Communications\CommunicationDispatcher;
use App\Services\Communications\CommunicationOutbox;
use App\Services\Communications\CommunicationProviderRegistry;
use App\Support\Communications\CommunicationChannel;
use App\Support\Communications\DispatchResult;
use App\Support\Communications\MessageClassification;
use App\Support\Communications\ProviderCapabilities;
use App\Tenancy\TenantContext;
use Closure;
use Illuminate\Support\Facades\DB;

/** أدوات اختبار الموزّع (AWJ-COMMS-03-A): تُستعمل مع `InteractsWithCommunicationEnqueue` و`InteractsWithCommunicationSchema`. */
trait InteractsWithCommunicationDispatch
{
    private function dispatchCaps(bool $idempotent = false): ProviderCapabilities
    {
        return new ProviderCapabilities(
            [CommunicationChannel::Sms, CommunicationChannel::Email],
            [MessageClassification::Transactional, MessageClassification::Service, MessageClassification::Otp],
            deliveryReceipts: true,
            providerIdempotency: $idempotent,
        );
    }

    /** @param  Closure(\App\Support\Communications\MessageIntent): DispatchResult|null  $onSend */
    private function probe(?Closure $onSend = null, bool $idempotent = false, string $key = 'probe'): CommunicationsProbeProvider
    {
        return new CommunicationsProbeProvider($key, $this->dispatchCaps($idempotent), $onSend ?? fn () => DispatchResult::accepted('prov-1'));
    }

    private function dispatcherFor(CommunicationsProbeProvider ...$providers): CommunicationDispatcher
    {
        $registry = new CommunicationProviderRegistry();
        foreach ($providers as $provider) {
            $registry->register($provider);
        }

        // الاختبارات داخل معاملة RefreshDatabase: مستواها الحالي هو «القاعدة» المسموحة.
        return CommunicationDispatcher::make($registry, DB::transactionLevel());
    }

    /** يدرج رسالة عبر خدمة الإدراج الحقيقية ويعيد معرّفها. @param array<string, mixed> $intent */
    private function enqueueMessage(string $tenantId, array $intent = []): string
    {
        app(TenantContext::class)->set($tenantId);
        $intent += ['key' => 'doc:'.bin2hex(random_bytes(6))];

        return CommunicationOutbox::make()->enqueue($this->commIntent($tenantId, $intent))->messageId;
    }

    /** رسالة بعمر 60 ثانية فقط (expires_at ثابت بعد الإنشاء فلا يُعدَّل لاحقاً). */
    private function enqueueShortLived(string $tenantId): string
    {
        $policy = config('communications.policy.transactional');
        config(['communications.policy.transactional' => ['ttl_seconds' => 60] + $policy]);

        try {
            return $this->enqueueMessage($tenantId);
        } finally {
            config(['communications.policy.transactional' => $policy]);
        }
    }

    private function messageRow(string $id): object
    {
        return DB::table('communication_messages')->where('id', $id)->first();
    }

    /** @return list<object> */
    private function attemptRows(string $messageId): array
    {
        return DB::table('communication_message_attempts')->where('message_id', $messageId)->orderBy('attempt_no')->get()->all();
    }

    /** يحاكي انهيار عامل بعد المطالبة: رسالة `sending` بإيجار منقضٍ ومحاولة `started` عالقة. */
    private function strandInSending(string $tenantId, string $messageId, string $providerKey = 'probe', int $attemptNo = 1, int $leaseExpiredSecondsAgo = 10): void
    {
        DB::table('communication_messages')->where('id', $messageId)->update([
            'status' => 'sending', 'attempt_count' => $attemptNo, 'next_attempt_at' => null,
            'lease_token' => (string) \Illuminate\Support\Str::uuid(), 'lease_until' => now()->subSeconds($leaseExpiredSecondsAgo)->toDateTimeString(),
        ]);
        $this->insertCommAttempt($tenantId, $messageId, ['attempt_no' => $attemptNo, 'provider_key' => $providerKey]);
    }

    private function payloadOf(string $messageId): ?array
    {
        return CommunicationMessage::query()->whereKey($messageId)->first()?->payload_encrypted;
    }
}
