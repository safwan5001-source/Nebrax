<?php

namespace Tests\Feature;

use App\Models\CommunicationMessage;
use App\Support\Communications\CommunicationChannel;
use App\Support\Communications\MessageRecipient;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use LogicException;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * AWJ-COMMS-FOUNDATION-02-A — الخصوصية: OTP بلا حمولة أو عنوان خام، الحمولة مشفَّرة وموجودة فقط في
 * الحالات القابلة للإرسال. الثوابت الحرجة تُفرض في القاعدة على المحرّكين (Trigger على SQLite، CHECK
 * على PostgreSQL)؛ حارس النموذج يغطي الشكل الباقي على SQLite.
 */
class CommunicationPrivacyTest extends TestCase
{
    use InteractsWithCommunicationSchema;
    use RefreshDatabase;

    private const SENTINEL_ADDRESS = '+966555123456';

    private const SENTINEL_CODE = '482913';

    private function otpRow(string $tenantId, array $overrides = []): array
    {
        return array_merge([
            'classification' => 'otp', 'template_key' => 'auth.otp', 'source' => 'auth.otp',
            'payload_encrypted' => null, 'max_attempts' => 1,
        ], $overrides);
    }

    #[Test]
    public function an_otp_row_is_a_ledger_only_record_without_payload(): void
    {
        $tenant = $this->commTenant();
        $id = $this->insertCommMessage($tenant->id, $this->otpRow($tenant->id));

        $row = DB::table('communication_messages')->where('id', $id)->first();
        $this->assertSame('otp', $row->classification);
        $this->assertNull($row->payload_encrypted);
        $this->assertSame(1, (int) $row->max_attempts);
        $this->assertSame('queued', $row->status);
    }

    #[Test]
    public function the_database_rejects_an_otp_payload_on_insert_and_update(): void
    {
        $tenant = $this->commTenant();

        $this->commRejects(fn () => $this->insertCommMessage($tenant->id, $this->otpRow($tenant->id, ['payload_encrypted' => 'cipher'])));

        $id = $this->insertCommMessage($tenant->id, $this->otpRow($tenant->id));
        $this->commRejects(fn () => DB::table('communication_messages')->where('id', $id)->update(['payload_encrypted' => 'cipher']));
        $this->assertNull(DB::table('communication_messages')->where('id', $id)->value('payload_encrypted'));
    }

    #[Test]
    public function the_database_enforces_a_single_attempt_for_otp(): void
    {
        $tenant = $this->commTenant();
        $this->commRejects(fn () => $this->insertCommMessage($tenant->id, $this->otpRow($tenant->id, ['max_attempts' => 2])));
        $this->assertSame(0, DB::table('communication_messages')->where('tenant_id', $tenant->id)->count());
    }

    #[Test]
    public function the_database_never_lets_an_otp_enter_retry_scheduled(): void
    {
        $tenant = $this->commTenant();

        $this->commRejects(fn () => $this->insertCommMessage($tenant->id, $this->otpRow($tenant->id, ['status' => 'retry_scheduled', 'attempt_count' => 1])));

        $id = $this->insertCommMessage($tenant->id, $this->otpRow($tenant->id, [
            'status' => 'sending', 'attempt_count' => 1, 'next_attempt_at' => null,
            'lease_token' => (string) Str::uuid(), 'lease_until' => now()->addMinutes(2)->toDateTimeString(),
        ]));

        $this->commRejects(fn () => DB::table('communication_messages')->where('id', $id)->update([
            'status' => 'retry_scheduled', 'lease_token' => null, 'lease_until' => null,
            'next_attempt_at' => now()->addMinute()->toDateTimeString(),
        ]));
        $this->assertSame('sending', DB::table('communication_messages')->where('id', $id)->value('status'));
    }

    #[Test]
    public function an_otp_that_was_never_sent_can_expire_and_one_with_unknown_outcome_stays_unknown(): void
    {
        $tenant = $this->commTenant();
        $never = $this->insertCommMessage($tenant->id, $this->otpRow($tenant->id));
        DB::table('communication_messages')->where('id', $never)->update([
            'status' => 'expired', 'next_attempt_at' => null, 'settled_at' => now()->toDateTimeString(), 'settled_reason' => 'final_status',
        ]);

        $lost = $this->insertCommMessage($tenant->id, $this->otpRow($tenant->id, [
            'status' => 'sending', 'attempt_count' => 1, 'next_attempt_at' => null,
            'lease_token' => (string) Str::uuid(), 'lease_until' => now()->addMinutes(2)->toDateTimeString(),
        ]));
        DB::table('communication_messages')->where('id', $lost)->update([
            'status' => 'unknown', 'lease_token' => null, 'lease_until' => null,
            'receipt_deadline_at' => now()->addDays(3)->toDateTimeString(), 'last_error_code' => 'unknown_outcome',
        ]);

        $this->assertSame('expired', DB::table('communication_messages')->where('id', $never)->value('status'));
        $this->assertSame('unknown', DB::table('communication_messages')->where('id', $lost)->value('status'));
    }

    #[Test]
    public function a_payload_cannot_outlive_the_sendable_states(): void
    {
        $tenant = $this->commTenant();
        $now = now()->toDateTimeString();

        $this->commRejects(fn () => $this->insertCommMessage($tenant->id, [
            'status' => 'accepted', 'attempt_count' => 1, 'next_attempt_at' => null,
            'accepted_at' => $now, 'receipt_deadline_at' => now()->addDay()->toDateTimeString(),
        ]));

        // انتقال يُخرج الرسالة من الحالات القابلة للإرسال دون مسح الحمولة يُجهَض (لا احتفاظ صامت).
        $id = $this->insertCommMessage($tenant->id, [
            'status' => 'sending', 'attempt_count' => 1, 'next_attempt_at' => null,
            'lease_token' => (string) Str::uuid(), 'lease_until' => now()->addMinutes(2)->toDateTimeString(),
        ]);
        $this->commRejects(fn () => DB::table('communication_messages')->where('id', $id)->update([
            'status' => 'accepted', 'lease_token' => null, 'lease_until' => null,
            'accepted_at' => $now, 'receipt_deadline_at' => now()->addDay()->toDateTimeString(),
        ]));
        $this->assertSame('sending', DB::table('communication_messages')->where('id', $id)->value('status'));
    }

    #[Test]
    public function the_model_guard_covers_the_shape_rules_sqlite_cannot_check(): void
    {
        $tenant = $this->commTenant();
        app(TenantContext::class)->set($tenant->id);
        $base = [
            'channel' => 'sms', 'classification' => 'transactional', 'template_key' => 't', 'source' => 's',
            'recipient_masked' => '+•••12', 'max_attempts' => 3, 'expires_at' => now()->addHour(),
            'payload_encrypted' => ['address' => self::SENTINEL_ADDRESS, 'variables' => []],
            'status' => 'queued', 'next_attempt_at' => now(),
        ];

        $invalid = [
            'unknown channel' => ['channel' => 'fax'],
            'unknown status' => ['status' => 'bogus'],
            'attempt_count over max' => ['attempt_count' => 4],
            'sending without lease' => ['status' => 'sending', 'next_attempt_at' => null],
            'queued with a lease' => ['lease_token' => (string) Str::uuid(), 'lease_until' => now()],
            'queued without next_attempt_at' => ['next_attempt_at' => null],
            'accepted without deadline' => ['status' => 'accepted', 'payload_encrypted' => null, 'next_attempt_at' => null, 'accepted_at' => now()],
            'terminal without settled_at' => ['status' => 'cancelled', 'payload_encrypted' => null, 'next_attempt_at' => null],
            'settled_at without reason' => ['status' => 'cancelled', 'payload_encrypted' => null, 'next_attempt_at' => null, 'settled_at' => now()],
            'bad settled_reason' => ['status' => 'cancelled', 'payload_encrypted' => null, 'next_attempt_at' => null, 'settled_at' => now(), 'settled_reason' => 'x'],
            'non-otp queued without payload' => ['payload_encrypted' => null],
            'payload outside sendable states' => ['status' => 'accepted', 'next_attempt_at' => null, 'accepted_at' => now(), 'receipt_deadline_at' => now()],
            'otp with payload' => ['classification' => 'otp', 'max_attempts' => 1],
            'otp with two attempts' => ['classification' => 'otp', 'payload_encrypted' => null, 'max_attempts' => 2],
            'otp retry_scheduled' => ['classification' => 'otp', 'payload_encrypted' => null, 'max_attempts' => 1, 'status' => 'retry_scheduled', 'attempt_count' => 1],
        ];

        foreach ($invalid as $label => $override) {
            $message = new CommunicationMessage($override + $base + ['idempotency_hash' => hash('sha256', $label)]);
            try {
                $message->save();
                $this->fail("model guard must reject: {$label}");
            } catch (LogicException $e) {
                // رسالة الحارس ثابتة ولا تحوي قيماً.
                $this->assertStringNotContainsString(self::SENTINEL_ADDRESS, $e->getMessage(), $label);
            }
        }
        $this->assertSame(0, DB::table('communication_messages')->count());
    }

    #[Test]
    public function the_payload_is_encrypted_at_rest_hidden_and_readable_through_the_model(): void
    {
        $tenant = $this->commTenant();
        app(TenantContext::class)->set($tenant->id);

        $message = CommunicationMessage::create([
            'channel' => 'sms', 'classification' => 'transactional', 'template_key' => 'invoice.issued', 'source' => 'invoicing',
            'idempotency_hash' => hash('sha256', 'enc'), 'recipient_masked' => '+•••56', 'max_attempts' => 3,
            'expires_at' => now()->addHour(), 'next_attempt_at' => now(),
            'payload_encrypted' => ['address' => self::SENTINEL_ADDRESS, 'variables' => ['code' => self::SENTINEL_CODE]],
        ]);

        $raw = (string) DB::table('communication_messages')->where('id', $message->id)->value('payload_encrypted');
        $this->assertNotSame('', $raw);
        $this->assertStringNotContainsString(self::SENTINEL_ADDRESS, $raw);
        $this->assertStringNotContainsString(self::SENTINEL_CODE, $raw);

        $fresh = CommunicationMessage::query()->findOrFail($message->id);
        $this->assertSame(self::SENTINEL_ADDRESS, $fresh->payload_encrypted['address']);

        $this->assertArrayNotHasKey('payload_encrypted', $fresh->toArray());
        $this->assertStringNotContainsString(self::SENTINEL_ADDRESS, $fresh->toJson());

        // لا يظهر العنوان ولا الرمز في أي عمود آخر من الصف.
        $row = json_encode((array) DB::table('communication_messages')->where('id', $message->id)->first(), JSON_UNESCAPED_UNICODE);
        $this->assertStringNotContainsString(self::SENTINEL_ADDRESS, $row);
        $this->assertStringNotContainsString(self::SENTINEL_CODE, $row);
    }

    #[Test]
    public function leaving_the_sendable_states_clears_the_payload_atomically_through_the_model(): void
    {
        $tenant = $this->commTenant();
        app(TenantContext::class)->set($tenant->id);
        $message = CommunicationMessage::create([
            'channel' => 'sms', 'classification' => 'transactional', 'template_key' => 't', 'source' => 's',
            'idempotency_hash' => hash('sha256', 'atomic'), 'recipient_masked' => '+•••56', 'max_attempts' => 3,
            'expires_at' => now()->addHour(), 'next_attempt_at' => now(),
            'payload_encrypted' => ['address' => self::SENTINEL_ADDRESS, 'variables' => []],
        ]);

        // الانتقال دون مسح الحمولة مرفوض...
        $message->forceFill(['status' => 'cancelled', 'next_attempt_at' => null, 'settled_at' => now(), 'settled_reason' => 'final_status']);
        try {
            $message->save();
            $this->fail('leaving sendable states without clearing the payload must be rejected');
        } catch (LogicException) {
        }

        // ...ومعه المسح في الجملة نفسها مقبول.
        $message->forceFill(['payload_encrypted' => null])->save();
        $this->assertNull(DB::table('communication_messages')->where('id', $message->id)->value('payload_encrypted'));
        $this->assertSame('cancelled', $message->fresh()->status);
    }

    #[Test]
    public function recipient_masked_fits_the_longest_valid_address_and_holds_only_the_masked_form(): void
    {
        $tenant = $this->commTenant();
        $local = str_repeat('a', 64);
        $domain = str_repeat('d', 61).'.'.str_repeat('e', 61).'.'.str_repeat('f', 61).'.com';
        $recipient = new MessageRecipient(CommunicationChannel::Email, $local.'@'.$domain);
        $this->assertLessThanOrEqual(320, strlen($recipient->masked()));

        $id = $this->insertCommMessage($tenant->id, ['channel' => 'email', 'recipient_masked' => $recipient->masked()]);
        $stored = (string) DB::table('communication_messages')->where('id', $id)->value('recipient_masked');
        $this->assertSame($recipient->masked(), $stored);
        $this->assertStringNotContainsString($local, $stored);

        $phone = new MessageRecipient(CommunicationChannel::Sms, self::SENTINEL_ADDRESS);
        $this->assertStringNotContainsString(self::SENTINEL_ADDRESS, $phone->masked());
    }

    #[Test]
    public function no_column_can_hold_a_raw_address_code_secret_or_provider_text(): void
    {
        $forbidden = '/(^|_)(address|phone|email|code|otp|secret|password|body|text|message|response|request|token)($|_)/';
        $allowed = ['payload_encrypted', 'provider_message_id', 'lease_token', 'last_error_code', 'error_code', 'message_id', 'recipient_masked'];

        foreach (['communication_messages', 'communication_message_attempts'] as $table) {
            foreach (Schema::getColumnListing($table) as $column) {
                if (in_array($column, $allowed, true)) {
                    continue;
                }
                $this->assertSame(0, preg_match($forbidden, $column), "{$table}.{$column} looks like it could store a sensitive value");
            }
        }
    }
}
