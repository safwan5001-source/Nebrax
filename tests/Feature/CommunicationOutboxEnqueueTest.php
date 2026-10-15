<?php

namespace Tests\Feature;

use App\Models\CommunicationMessage;
use App\Services\Communications\CommunicationOutbox;
use App\Support\Communications\CommunicationChannel;
use App\Support\Communications\CommunicationProvider;
use App\Support\Communications\CommunicationsConfigurationException;
use App\Support\Communications\CommunicationsPolicyException;
use App\Support\Communications\CommunicationsStorageException;
use App\Support\Communications\DeliveryStatus;
use App\Support\Communications\EnqueueOutcome;
use App\Support\Communications\IdempotencyConflictException;
use App\Support\Communications\IdempotencyUnverifiableException;
use App\Support\Communications\MessageClassification;
use App\Support\Communications\TenantMismatchException;
use App\Tenancy\TenantContext;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * AWJ-COMMS-02-B — الإدراج الآمن المتكرّر-الأمان على SQLite وPostgreSQL: إدراج أول، إعادة مطابقة، تعارض، عزل المستأجرين،
 * مفاتيح HMAC بإصدارات، الخصوصية والتشفير، قيود OTP، وسباق حتمي (التزامن الحقيقي في ملف PostgreSQL المنفصل).
 */
class CommunicationOutboxEnqueueTest extends TestCase
{
    use InteractsWithCommunicationEnqueue;
    use InteractsWithCommunicationSchema;
    use RefreshDatabase;

    private const ADDRESS = '+966555123456';

    private const CODE = '482913';

    protected function setUp(): void
    {
        parent::setUp();
        $this->configureCommunicationsHmac();
        config(['communications.policy' => [
            'otp' => ['ttl_seconds' => 300, 'max_attempts' => 1],
            'transactional' => ['ttl_seconds' => 3600, 'max_attempts' => 3],
            'service' => ['ttl_seconds' => 7200, 'max_attempts' => 2],
        ]]);
    }

    private function as(string $tenantId): CommunicationOutbox
    {
        app(TenantContext::class)->set($tenantId);

        return CommunicationOutbox::make();
    }

    // ───────────────────────── الإدراج الأول ─────────────────────────

    #[Test]
    public function the_first_enqueue_creates_one_queued_message_with_policy_fingerprint_and_masked_recipient(): void
    {
        $tenant = $this->commTenant();
        $intent = $this->commIntent($tenant->id, ['address' => self::ADDRESS]);

        $result = $this->as($tenant->id)->enqueue($intent);

        $this->assertSame(EnqueueOutcome::Created, $result->outcome);
        $this->assertTrue($result->wasCreated());
        $this->assertSame(DeliveryStatus::Queued, $result->status);

        $row = DB::table('communication_messages')->where('id', $result->messageId)->first();
        $this->assertSame($tenant->id, $row->tenant_id);
        $this->assertSame('sms', $row->channel);
        $this->assertSame('transactional', $row->classification);
        $this->assertSame('invoice.issued', $row->template_key);
        $this->assertSame('invoicing.issue', $row->source);
        $this->assertSame($intent->idempotencyHash(), trim($row->idempotency_hash));
        $this->assertSame('+•••56', $row->recipient_masked);
        $this->assertSame('queued', $row->status);
        $this->assertSame(0, (int) $row->attempt_count);
        $this->assertSame(3, (int) $row->max_attempts);
        $this->assertNotNull($row->next_attempt_at);
        $this->assertEqualsWithDelta(3600, strtotime($row->expires_at) - strtotime($row->created_at), 5);
        $this->assertMatchesRegularExpression('/^[0-9a-f]{64}$/', trim($row->request_fingerprint));
        $this->assertSame(1, (int) $row->hash_key_version);
        $this->assertSame(1, DB::table('communication_messages')->count());
    }

    // ───────────────────────── إعادة المطابقة ─────────────────────────

    #[Test]
    public function an_identical_repeated_request_returns_the_existing_message_without_a_second_row(): void
    {
        $tenant = $this->commTenant();
        $outbox = $this->as($tenant->id);

        $first = $outbox->enqueue($this->commIntent($tenant->id));
        $second = $outbox->enqueue($this->commIntent($tenant->id));

        $this->assertSame($first->messageId, $second->messageId);
        $this->assertSame(EnqueueOutcome::Replayed, $second->outcome);
        $this->assertSame(1, DB::table('communication_messages')->count());
    }

    #[Test]
    public function a_replay_after_the_payload_was_scrubbed_is_still_verified_against_the_stored_fingerprint(): void
    {
        $tenant = $this->commTenant();
        $outbox = $this->as($tenant->id);
        $first = $outbox->enqueue($this->commIntent($tenant->id));

        // الرسالة أُرسلت وقبلها المزوّد: الحمولة مُسحت (قيد الحالة) ومعها زال مصدر المقارنة القديم.
        DB::table('communication_messages')->where('id', $first->messageId)->update([
            'status' => 'sending', 'attempt_count' => 1, 'next_attempt_at' => null,
            'lease_token' => (string) \Illuminate\Support\Str::uuid(), 'lease_until' => now()->addMinute()->toDateTimeString(),
        ]);
        DB::table('communication_messages')->where('id', $first->messageId)->update([
            'status' => 'accepted', 'payload_encrypted' => null, 'lease_token' => null, 'lease_until' => null,
            'accepted_at' => now()->toDateTimeString(), 'receipt_deadline_at' => now()->addDays(3)->toDateTimeString(),
        ]);

        $replay = $outbox->enqueue($this->commIntent($tenant->id));
        $this->assertSame(EnqueueOutcome::Replayed, $replay->outcome);
        $this->assertSame(DeliveryStatus::Accepted, $replay->status);

        // وتغيّر المستلم بعد الإرسال يُكشف (هذا ما لم تكن الـSchema القديمة قادرة عليه).
        $this->expectException(IdempotencyConflictException::class);
        $outbox->enqueue($this->commIntent($tenant->id, ['address' => '+966500000099']));
    }

    // ───────────────────────── التعارض ─────────────────────────

    /** @return array<string, array{0: array<string, mixed>}> */
    public static function changedRequests(): array
    {
        return [
            'different recipient with the same last two digits' => [['address' => '+966511111101']],
            'different variables' => [['variables' => ['invoice_no' => 'INV-2']]],
            'extra variable' => [['variables' => ['invoice_no' => 'INV-1', 'x' => 'y']]],
            'different template' => [['template' => 'invoice.reminder']],
            'different source' => [['source' => 'other.source']],
            'different channel' => [['channel' => CommunicationChannel::WhatsApp]],
            'different classification' => [['classification' => MessageClassification::Service]],
        ];
    }

    /** @param  array<string, mixed>  $change */
    #[Test]
    #[DataProvider('changedRequests')]
    public function the_same_key_with_different_content_is_an_explicit_conflict_and_creates_nothing(array $change): void
    {
        $tenant = $this->commTenant();
        $outbox = $this->as($tenant->id);
        $outbox->enqueue($this->commIntent($tenant->id));

        try {
            $outbox->enqueue($this->commIntent($tenant->id, $change));
            $this->fail('the changed request must be rejected');
        } catch (IdempotencyConflictException $e) {
            $this->assertStringNotContainsString($tenant->id, $e->getMessage());
            $this->assertNull($e->getPrevious());
        }

        $this->assertSame(1, DB::table('communication_messages')->count());
    }

    #[Test]
    public function the_stored_row_is_never_modified_by_a_conflicting_attempt(): void
    {
        $tenant = $this->commTenant();
        $outbox = $this->as($tenant->id);
        $id = $outbox->enqueue($this->commIntent($tenant->id))->messageId;
        $before = (array) DB::table('communication_messages')->where('id', $id)->first();

        try {
            $outbox->enqueue($this->commIntent($tenant->id, ['variables' => ['invoice_no' => 'CHANGED']]));
            $this->fail('conflict expected');
        } catch (IdempotencyConflictException) {
        }

        $this->assertEquals($before, (array) DB::table('communication_messages')->where('id', $id)->first());
    }

    // ───────────────────────── المستأجرون ─────────────────────────

    #[Test]
    public function different_tenants_using_the_same_key_and_content_stay_independent(): void
    {
        $a = $this->commTenant('a');
        $b = $this->commTenant('b');

        $first = $this->as($a->id)->enqueue($this->commIntent($a->id));
        $second = $this->as($b->id)->enqueue($this->commIntent($b->id));

        $this->assertSame(EnqueueOutcome::Created, $first->outcome);
        $this->assertSame(EnqueueOutcome::Created, $second->outcome);
        $this->assertNotSame($first->messageId, $second->messageId);

        $rows = DB::table('communication_messages')->get()->keyBy('tenant_id');
        $this->assertNotSame(trim($rows[$a->id]->idempotency_hash), trim($rows[$b->id]->idempotency_hash));
        // اشتقاق المفتاح لكل مستأجر: نفس الطلب ⇒ بصمتان مختلفتان (لا ارتباط عبر المستأجرين).
        $this->assertNotSame(trim($rows[$a->id]->request_fingerprint), trim($rows[$b->id]->request_fingerprint));

        app(TenantContext::class)->set($a->id);
        $this->assertSame([$first->messageId], CommunicationMessage::query()->pluck('id')->all());
    }

    #[Test]
    public function the_tenant_comes_only_from_the_trusted_context(): void
    {
        $a = $this->commTenant('a');
        $b = $this->commTenant('b');
        $outbox = $this->as($a->id);

        try {
            $outbox->enqueue($this->commIntent($b->id));
            $this->fail('an intent for another tenant must be rejected');
        } catch (TenantMismatchException $e) {
            $this->assertStringNotContainsString($b->id, $e->getMessage());
        }

        $this->assertSame(0, DB::table('communication_messages')->count());
    }

    #[Test]
    public function enqueue_without_a_tenant_context_fails_closed(): void
    {
        $tenant = $this->commTenant();
        app(TenantContext::class)->forget();
        $outbox = CommunicationOutbox::make();

        $this->expectException(TenantMismatchException::class);
        $outbox->enqueue($this->commIntent($tenant->id));
    }

    // ───────────────────────── HMAC: تهيئة وتدوير ─────────────────────────

    #[Test]
    public function missing_or_invalid_hmac_configuration_fails_closed_before_any_insert(): void
    {
        $tenant = $this->commTenant();

        foreach ([
            fn () => config(['communications.hmac' => ['active_version' => null, 'keys' => []]]),
            fn () => config(['communications.hmac' => ['active_version' => 1, 'keys' => []]]),
            fn () => config(['communications.hmac' => ['active_version' => 1, 'keys' => [1 => 'not base64!!']]]),
            fn () => config(['communications.hmac' => ['active_version' => 1, 'keys' => [1 => base64_encode('short')]]]),
            fn () => config(['communications.hmac' => ['active_version' => 'x', 'keys' => [1 => $this->commTestKey()]]]),
        ] as $break) {
            $break();
            try {
                $this->as($tenant->id)->enqueue($this->commIntent($tenant->id));
                $this->fail('enqueue must fail closed on invalid HMAC configuration');
            } catch (CommunicationsConfigurationException) {
                $this->assertSame(0, DB::table('communication_messages')->count());
            }
        }
    }

    #[Test]
    public function rotation_keeps_old_rows_verifiable_by_their_stored_version_and_new_rows_use_the_active_one(): void
    {
        $tenant = $this->commTenant();
        $k1 = $this->commTestKey();
        $k2 = $this->commTestKey();

        $this->configureCommunicationsHmac([1 => $k1], 1);
        $old = $this->as($tenant->id)->enqueue($this->commIntent($tenant->id));

        // تدوير: النشط 2 والقديم باقٍ.
        $this->configureCommunicationsHmac([1 => $k1, 2 => $k2], 2);
        $outbox = $this->as($tenant->id);
        $replay = $outbox->enqueue($this->commIntent($tenant->id));
        $this->assertSame(EnqueueOutcome::Replayed, $replay->outcome, 'no false conflict after rotation');
        $this->assertSame($old->messageId, $replay->messageId);

        $new = $outbox->enqueue($this->commIntent($tenant->id, ['key' => 'invoice:124:issued']));
        $this->assertSame(2, (int) DB::table('communication_messages')->where('id', $new->messageId)->value('hash_key_version'));
        $this->assertSame(1, (int) DB::table('communication_messages')->where('id', $old->messageId)->value('hash_key_version'));

        // تغيّر المحتوى لا يزال يُكشف على صف الإصدار القديم.
        try {
            $outbox->enqueue($this->commIntent($tenant->id, ['variables' => ['invoice_no' => 'INV-9']]));
            $this->fail('conflict must still be detected for an old-version row');
        } catch (IdempotencyConflictException) {
        }

        // سحب المفتاح القديم قبل خلو الصفوف ⇒ فشل مغلق (لا يُفترض تطابق).
        $this->configureCommunicationsHmac([2 => $k2], 2);
        $this->expectException(CommunicationsConfigurationException::class);
        $this->as($tenant->id)->enqueue($this->commIntent($tenant->id));
    }

    // ───────────────────────── الخصوصية والتشفير ─────────────────────────

    #[Test]
    public function recipient_and_variables_are_never_stored_in_plaintext_and_the_payload_is_encrypted_at_rest(): void
    {
        $tenant = $this->commTenant();
        $result = $this->as($tenant->id)->enqueue($this->commIntent($tenant->id, [
            'address' => self::ADDRESS, 'variables' => ['invoice_no' => 'INV-SECRET-77'],
        ]));

        $row = (array) DB::table('communication_messages')->where('id', $result->messageId)->first();
        $dump = json_encode($row, JSON_UNESCAPED_UNICODE);
        $this->assertStringNotContainsString(self::ADDRESS, $dump);
        $this->assertStringNotContainsString('INV-SECRET-77', $dump);
        $this->assertStringNotContainsString('invoice:123:issued', $dump, 'the raw idempotency key is not stored');

        $decrypted = json_decode(Crypt::decryptString($row['payload_encrypted']), true);
        $this->assertSame(self::ADDRESS, $decrypted['address']);
        $this->assertSame(['invoice_no' => 'INV-SECRET-77'], $decrypted['variables']);

        app(TenantContext::class)->set($tenant->id);
        $model = CommunicationMessage::query()->findOrFail($result->messageId);
        $this->assertSame(self::ADDRESS, $model->payload_encrypted['address']);
        $this->assertStringNotContainsString(self::ADDRESS, $model->toJson());
    }

    #[Test]
    public function the_fingerprint_is_a_keyed_digest_not_a_plain_hash_of_the_request(): void
    {
        $tenant = $this->commTenant();
        $intent = $this->commIntent($tenant->id);
        $id = $this->as($tenant->id)->enqueue($intent)->messageId;
        $stored = trim((string) DB::table('communication_messages')->where('id', $id)->value('request_fingerprint'));

        $canonical = \App\Support\Communications\RequestCanonicalizer::canonicalize($intent);
        $this->assertNotSame(hash('sha256', $canonical), $stored);
        $this->assertNotSame(hash('sha256', $tenant->id.$canonical), $stored);
    }

    // ───────────────────────── OTP ─────────────────────────

    #[Test]
    public function an_otp_is_a_ledger_only_row_with_no_payload_no_raw_address_and_a_single_attempt(): void
    {
        config(['communications.policy.otp' => ['ttl_seconds' => 300, 'max_attempts' => 5]]);
        $tenant = $this->commTenant();
        $intent = $this->commIntent($tenant->id, [
            'classification' => MessageClassification::Otp, 'address' => self::ADDRESS,
            'variables' => ['code' => self::CODE], 'key' => 'otp:7d3c1d2e-1111-4222-8333-444455556666', 'template' => 'auth.otp', 'source' => 'auth.otp',
        ]);

        $result = $this->as($tenant->id)->enqueue($intent);

        $row = (array) DB::table('communication_messages')->where('id', $result->messageId)->first();
        $this->assertNull($row['payload_encrypted']);
        $this->assertSame(1, (int) $row['max_attempts'], 'OTP is single-attempt regardless of configuration');
        $this->assertSame('queued', $row['status']);
        $this->assertEqualsWithDelta(300, strtotime($row['expires_at']) - strtotime($row['created_at']), 5);
        $dump = json_encode($row, JSON_UNESCAPED_UNICODE);
        $this->assertStringNotContainsString(self::ADDRESS, $dump);
        $this->assertStringNotContainsString(self::CODE, $dump);
        $this->assertSame('+•••56', $row['recipient_masked']);
    }

    #[Test]
    public function an_otp_replay_detects_a_different_recipient_but_ignores_the_code_by_design(): void
    {
        $tenant = $this->commTenant();
        $base = ['classification' => MessageClassification::Otp, 'key' => 'otp:7d3c1d2e-1111-4222-8333-444455556666', 'template' => 'auth.otp', 'source' => 'auth.otp'];
        $outbox = $this->as($tenant->id);
        $first = $outbox->enqueue($this->commIntent($tenant->id, $base + ['variables' => ['code' => self::CODE]]));

        $replay = $outbox->enqueue($this->commIntent($tenant->id, $base + ['variables' => ['code' => '000000']]));
        $this->assertSame(EnqueueOutcome::Replayed, $replay->outcome);
        $this->assertSame($first->messageId, $replay->messageId);

        $this->expectException(IdempotencyConflictException::class);
        $outbox->enqueue($this->commIntent($tenant->id, $base + ['address' => '+966500000099', 'variables' => ['code' => self::CODE]]));
    }

    #[Test]
    public function an_otp_key_embedding_the_code_or_the_address_is_rejected(): void
    {
        $tenant = $this->commTenant();
        $outbox = $this->as($tenant->id);
        $base = ['classification' => MessageClassification::Otp, 'template' => 'auth.otp', 'source' => 'auth.otp'];

        foreach ([
            ['key' => 'otp:'.self::CODE, 'variables' => ['code' => self::CODE]],
            ['key' => 'otp:966555123456', 'address' => self::ADDRESS, 'variables' => ['code' => '111111']],
            // رمز قصير (3 خانات) كجزء كامل أو كسلسلة فرعية، وكلمة بأحرف مختلفة.
            ['key' => 'otp:login:123:1', 'variables' => ['code' => '123']],
            ['key' => 'otp:x742y', 'variables' => ['code' => '742']],
            ['key' => 'otp:AbC9', 'variables' => ['code' => 'abc9']],
            ['key' => 'otp:login:7', 'variables' => ['code' => '7']],
        ] as $case) {
            try {
                $outbox->enqueue($this->commIntent($tenant->id, $base + $case));
                $this->fail('the key must not embed sensitive data');
            } catch (CommunicationsPolicyException) {
            }
        }
        $this->assertSame(0, DB::table('communication_messages')->count());
    }

    // ───────────────────────── السياسة ─────────────────────────

    #[Test]
    public function marketing_is_rejected_until_a_consent_registry_exists(): void
    {
        $tenant = $this->commTenant();

        $this->expectException(CommunicationsPolicyException::class);
        $this->as($tenant->id)->enqueue($this->commIntent($tenant->id, ['classification' => MessageClassification::Marketing]));
    }

    #[Test]
    public function an_invalid_policy_is_rejected_and_a_key_embedding_the_address_is_rejected_for_all_classes(): void
    {
        $tenant = $this->commTenant();
        $outbox = $this->as($tenant->id);

        config(['communications.policy.transactional' => ['ttl_seconds' => 0, 'max_attempts' => 3]]);
        try {
            $outbox->enqueue($this->commIntent($tenant->id));
            $this->fail('a zero TTL is invalid');
        } catch (CommunicationsPolicyException) {
        }

        config(['communications.policy.transactional' => ['ttl_seconds' => 60, 'max_attempts' => 99]]);
        try {
            $outbox->enqueue($this->commIntent($tenant->id));
            $this->fail('an excessive attempt count is invalid');
        } catch (CommunicationsPolicyException) {
        }

        config(['communications.policy.transactional' => ['ttl_seconds' => 60, 'max_attempts' => 3]]);
        foreach (['notify:966555123456', 'notify:966555123456:issued', 'N-966555123456'] as $key) {
            try {
                $outbox->enqueue($this->commIntent($tenant->id, ['key' => $key, 'address' => self::ADDRESS]));
                $this->fail("key {$key} must be rejected");
            } catch (CommunicationsPolicyException) {
            }
        }
        $this->assertSame(0, DB::table('communication_messages')->count());

        // قيمة متغير غير OTP داخل المفتاح مقبولة (معرّف مستند مشروع).
        $ok = $outbox->enqueue($this->commIntent($tenant->id, ['key' => 'invoice:INV-1:issued', 'variables' => ['invoice_no' => 'INV-1']]));
        $this->assertTrue($ok->wasCreated());
    }

    // ───────────────────────── السباق والأعطال ─────────────────────────

    /**
     * يُدرج منافساً **مُلتزَماً** بين المسار السريع (SELECT) والإدراج: سباق حتمي على المحرّكين. الحدث هنا خارج معاملة
     * الإدراج، فالصف المنافس يبقى بعد فشل الإدراج الأصلي (على عكس إدراجه من داخل حدث creating فيُتراجع معه).
     */
    private function raceAfterFastPath(callable $competitor): callable
    {
        $fired = false;
        app('events')->listen(QueryExecuted::class, function (QueryExecuted $query) use (&$fired, $competitor) {
            if (! $fired && stripos($query->sql, 'communication_messages') !== false && stripos(ltrim($query->sql), 'select') === 0) {
                $fired = true;
                $competitor();
            }
        });

        return fn () => app('events')->forget(QueryExecuted::class);
    }

    /** يرمي من داخل إنشاء الصف (داخل معاملة الإدراج): فشل تخزين غير تفرّد. */
    private function raceWith(callable $competitor): callable
    {
        $fired = false;
        $listener = function () use (&$fired, $competitor) {
            if (! $fired) {
                $fired = true;
                $competitor();
            }
        };
        app('events')->listen('eloquent.creating: '.CommunicationMessage::class, $listener);

        return fn () => app('events')->forget('eloquent.creating: '.CommunicationMessage::class);
    }

    #[Test]
    public function a_unique_constraint_race_is_resolved_by_the_database_into_a_replay(): void
    {
        $tenant = $this->commTenant();
        $outbox = $this->as($tenant->id);
        $cleanup = $this->raceAfterFastPath(fn () => $outbox->enqueue($this->commIntent($tenant->id)));

        try {
            $result = $outbox->enqueue($this->commIntent($tenant->id));
        } finally {
            $cleanup();
        }

        $this->assertSame(EnqueueOutcome::Replayed, $result->outcome);
        $this->assertSame(1, DB::table('communication_messages')->count());
        $this->assertSame($result->messageId, DB::table('communication_messages')->value('id'));
    }

    #[Test]
    public function a_race_lost_to_a_different_request_becomes_a_conflict_not_a_duplicate(): void
    {
        $tenant = $this->commTenant();
        $outbox = $this->as($tenant->id);
        $cleanup = $this->raceAfterFastPath(fn () => $outbox->enqueue($this->commIntent($tenant->id, ['variables' => ['invoice_no' => 'WINNER']])));

        try {
            $outbox->enqueue($this->commIntent($tenant->id, ['variables' => ['invoice_no' => 'LOSER']]));
            $this->fail('the losing, different request must be a conflict');
        } catch (IdempotencyConflictException) {
        } finally {
            $cleanup();
        }

        $this->assertSame(1, DB::table('communication_messages')->count());
    }

    #[Test]
    public function an_unexpected_database_failure_is_a_storage_error_not_an_idempotency_conflict(): void
    {
        $tenant = $this->commTenant();
        $outbox = $this->as($tenant->id);
        Log::spy();
        $cleanup = $this->raceWith(function () {
            throw new QueryException('testing', 'insert into x (secret) values (?)', [self::ADDRESS], new \PDOException('boom '.self::ADDRESS));
        });

        try {
            $outbox->enqueue($this->commIntent($tenant->id, ['address' => self::ADDRESS]));
            $this->fail('a storage failure must surface');
        } catch (CommunicationsStorageException $e) {
            $this->assertNotInstanceOf(IdempotencyConflictException::class, $e);
            $this->assertNull($e->getPrevious(), 'the QueryException (with bindings) is not chained');
            $this->assertStringNotContainsString(self::ADDRESS, $e->getMessage());
        } finally {
            $cleanup();
        }

        $this->assertSame(0, DB::table('communication_messages')->count());
        Log::shouldHaveReceived('error')->withArgs(function (string $message, array $context) {
            return $message === 'communications.enqueue.storage_failure'
                && array_keys($context) === ['tenant_id', 'sqlstate']
                && ! str_contains(json_encode($context), self::ADDRESS);
        })->once();
    }

    /**
     * قاعدة غير متاحة باستمرار: يمرّ المسار السريع (إن طُلب) ثم تفشل كل استعلامات الجدول، بما فيها استعلام الاسترداد.
     * الاستثناء يُرمى قبل غلاف الاتصال فيصل المعالج QueryException خاماً كما في انقطاع حقيقي.
     */
    private function failTableQueriesAfter(int $allowedSelects, string $insertSqlState = 'HY000', string $lookupSqlState = 'HY000'): void
    {
        $seen = 0;
        $failure = static function (string $sql, string $sqlState): QueryException {
            // QueryException يقرأ SQLSTATE من الاستثناء السابق.
            $pdo = new class($sqlState, 'connection lost '.self::ADDRESS) extends \PDOException {
                public function __construct(string $sqlState, string $message)
                {
                    parent::__construct($message);
                    $this->code = $sqlState;
                }
            };

            return new QueryException('testing', $sql, [self::ADDRESS], $pdo);
        };

        DB::beforeExecuting(function (string $sql) use (&$seen, $allowedSelects, $insertSqlState, $lookupSqlState, $failure) {
            if (stripos($sql, 'communication_messages') === false) {
                return;
            }
            if (stripos(ltrim($sql), 'select') === 0) {
                if (++$seen <= $allowedSelects) {
                    return;
                }

                throw $failure($sql, $lookupSqlState);
            }

            throw $failure($sql, $insertSqlState);
        });
    }

    #[Test]
    public function a_persistent_outage_during_the_recovery_lookup_is_still_a_storage_error(): void
    {
        $tenant = $this->commTenant();
        $outbox = $this->as($tenant->id);
        Log::spy();
        $this->failTableQueriesAfter(1);

        try {
            $outbox->enqueue($this->commIntent($tenant->id));
            $this->fail('a persistent outage must surface as a storage error');
        } catch (CommunicationsStorageException $e) {
            $this->assertNull($e->getPrevious());
            $this->assertStringNotContainsString(self::ADDRESS, $e->getMessage());
        }

        Log::shouldHaveReceived('error')->withArgs(fn (string $m, array $c) => $m === 'communications.enqueue.storage_failure'
            && array_keys($c) === ['tenant_id', 'sqlstate'] && ! str_contains(json_encode($c), self::ADDRESS))->once();
    }

    #[Test]
    public function the_logged_sqlstate_is_the_one_of_the_lookup_that_failed_not_the_original_insert_conflict(): void
    {
        $tenant = $this->commTenant();
        $outbox = $this->as($tenant->id);
        Log::spy();
        // الإدراج يفشل بـ23505 ثم يفشل البحث بـ08006 (انقطاع اتصال).
        $this->failTableQueriesAfter(1, insertSqlState: '23505', lookupSqlState: '08006');

        try {
            $outbox->enqueue($this->commIntent($tenant->id));
            $this->fail('a failed recovery lookup must surface as a storage error');
        } catch (CommunicationsStorageException) {
        }

        Log::shouldHaveReceived('error')->withArgs(fn (string $m, array $c) => $c['sqlstate'] === '08006')->once();
    }

    #[Test]
    public function an_outage_during_the_fast_path_lookup_is_a_storage_error_too(): void
    {
        $tenant = $this->commTenant();
        $outbox = $this->as($tenant->id);
        $this->failTableQueriesAfter(0);

        $this->expectException(CommunicationsStorageException::class);
        $outbox->enqueue($this->commIntent($tenant->id));
    }

    #[Test]
    public function a_legacy_row_without_a_fingerprint_is_unverifiable_never_a_match(): void
    {
        $tenant = $this->commTenant();
        $migration = require database_path('migrations/2026_11_10_020000_add_request_fingerprint_to_communication_messages.php');
        $migration->down();
        $intent = $this->commIntent($tenant->id);
        DB::table('communication_messages')->insert($this->legacyCommMessageRow($tenant->id, ['idempotency_hash' => $intent->idempotencyHash()]));
        $migration->up();

        $this->expectException(IdempotencyUnverifiableException::class);
        $this->as($tenant->id)->enqueue($intent);
    }

    // ───────────────────────── التوافق ─────────────────────────

    #[Test]
    public function the_merged_contracts_and_otp_wiring_are_untouched(): void
    {
        $this->assertFalse(app()->bound(CommunicationProvider::class));
        $this->assertInstanceOf(\App\Services\Commerce\Otp\FakeOtpProvider::class, app(\App\Services\Commerce\Otp\OtpProvider::class));

        $tenant = $this->commTenant();
        $intent = $this->commIntent($tenant->id);
        $id = $this->as($tenant->id)->enqueue($intent)->messageId;

        // العمود يطابق الهاش المعرَّف في عقد #1494 حرفياً.
        $this->assertSame(hash('sha256', $tenant->id."\n".$intent->idempotencyKey), trim((string) DB::table('communication_messages')->where('id', $id)->value('idempotency_hash')));
        $this->assertStringNotContainsString('describe', json_encode(DB::table('communication_messages')->first()));
    }

    #[Test]
    public function the_service_makes_no_network_calls(): void
    {
        \Illuminate\Support\Facades\Http::fake();
        $tenant = $this->commTenant();

        $this->as($tenant->id)->enqueue($this->commIntent($tenant->id));

        \Illuminate\Support\Facades\Http::assertNothingSent();
    }
}
