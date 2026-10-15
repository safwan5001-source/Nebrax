<?php

namespace Tests\Feature;

use App\Models\CommunicationMessage;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use LogicException;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * AWJ-COMMS-FOUNDATION-02-B1 — قيود بصمة الطلب وإصدار المفتاح (SQLite وPostgreSQL).
 *
 * لا حساب HMAC هنا (مؤجَّل لـ02-B): قيم الاختبار hex بالشكل الصحيح فقط. يثبت: nullable بالشكل المعتمد، معاً أو
 * لا شيء، صيغة صالحة، ثبات بعد الإدراج (يشمل تحديثات الـquery builder الخام)، رفض الصف الجديد بلا بصمة، عدم
 * كشف مستأجر عبر البصمة، وعدم إضافة فهارس. اختبارات الصفوف القديمة والترحيل في `CommunicationFingerprintMigrationTest`.
 */
class CommunicationFingerprintSchemaTest extends TestCase
{
    use InteractsWithCommunicationSchema;
    use RefreshDatabase;

    private const FP_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

    private const FP_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

    #[Test]
    public function the_two_columns_exist_as_nullable_with_the_approved_types(): void
    {
        $columns = collect(Schema::getColumns('communication_messages'))->keyBy('name');

        $this->assertTrue($columns['request_fingerprint']['nullable']);
        $this->assertTrue($columns['hash_key_version']['nullable']);
        $this->assertNull($columns['request_fingerprint']['default']);
        $this->assertNull($columns['hash_key_version']['default']);
        if ($this->commDriver() === 'pgsql') {
            $this->assertSame('character(64)', $columns['request_fingerprint']['type']);
            $this->assertSame('int2', $columns['hash_key_version']['type_name']);
        }
        $this->assertFalse(Schema::hasColumn('communication_messages', 'recipient_hash'));
    }

    #[Test]
    public function a_row_with_a_valid_fingerprint_and_version_is_stored_verbatim(): void
    {
        $tenant = $this->commTenant();
        $id = $this->insertCommMessage($tenant->id, ['request_fingerprint' => self::FP_A, 'hash_key_version' => 7]);

        $row = DB::table('communication_messages')->where('id', $id)->first();
        $this->assertSame(self::FP_A, trim((string) $row->request_fingerprint));
        $this->assertSame(7, (int) $row->hash_key_version);
    }

    #[Test]
    public function the_largest_smallint_version_is_accepted(): void
    {
        $tenant = $this->commTenant();
        $id = $this->insertCommMessage($tenant->id, ['hash_key_version' => 32767]);

        $this->assertSame(32767, (int) DB::table('communication_messages')->where('id', $id)->value('hash_key_version'));
    }

    #[Test]
    public function a_new_row_without_fingerprint_metadata_is_rejected(): void
    {
        $tenant = $this->commTenant();

        $e = $this->commRejects(fn () => DB::table('communication_messages')->insert($this->legacyCommMessageRow($tenant->id)));

        $this->assertStringContainsString('communication_messages:', $e->getMessage());
        $this->assertSame(0, DB::table('communication_messages')->count());
    }

    /** @return array<string, array{0: array<string, mixed>}> */
    public static function partialOrInvalidMetadata(): array
    {
        return [
            'fingerprint without version' => [['request_fingerprint' => self::FP_A, 'hash_key_version' => null]],
            'version without fingerprint' => [['request_fingerprint' => null, 'hash_key_version' => 1]],
            'both missing' => [['request_fingerprint' => null, 'hash_key_version' => null]],
            'too short (63)' => [['request_fingerprint' => str_repeat('a', 63)]],
            'too long (65)' => [['request_fingerprint' => str_repeat('a', 65)]],
            'empty string' => [['request_fingerprint' => '']],
            'uppercase hex' => [['request_fingerprint' => str_repeat('A', 64)]],
            'non hex character' => [['request_fingerprint' => str_repeat('a', 63).'g']],
            'trailing newline' => [['request_fingerprint' => str_repeat('a', 64)."\n"]],
            'embedded space' => [['request_fingerprint' => str_repeat('a', 31).' '.str_repeat('a', 32)]],
            'version zero' => [['hash_key_version' => 0]],
            'negative version' => [['hash_key_version' => -1]],
            'version above smallint' => [['hash_key_version' => 32768]],
            'non numeric version' => [['hash_key_version' => 'abc']],
        ];
    }

    /** @param  array<string, mixed>  $override */
    #[Test]
    #[DataProvider('partialOrInvalidMetadata')]
    public function partial_or_malformed_metadata_is_rejected_by_the_database(array $override): void
    {
        $tenant = $this->commTenant();

        $this->commRejects(fn () => $this->insertCommMessage($tenant->id, $override));

        $this->assertSame(0, DB::table('communication_messages')->where('tenant_id', $tenant->id)->count());
    }

    #[Test]
    public function the_pair_and_format_rules_also_reject_updates_even_before_immutability(): void
    {
        $tenant = $this->commTenant();
        $id = $this->insertCommMessage($tenant->id, ['request_fingerprint' => self::FP_A, 'hash_key_version' => 1]);

        // نفس القيمة المقبولة تُسامَح؛ تغيير أحدهما أو كليهما أو مسحهما مرفوض.
        $this->assertSame(1, DB::table('communication_messages')->where('id', $id)->update([
            'request_fingerprint' => self::FP_A, 'hash_key_version' => 1, 'attempt_count' => 1,
        ]));

        foreach ([
            'new fingerprint' => ['request_fingerprint' => self::FP_B],
            'new version' => ['hash_key_version' => 2],
            'both new' => ['request_fingerprint' => self::FP_B, 'hash_key_version' => 2],
            'clear fingerprint' => ['request_fingerprint' => null],
            'clear version' => ['hash_key_version' => null],
            'clear both' => ['request_fingerprint' => null, 'hash_key_version' => null],
            'malformed' => ['request_fingerprint' => 'zz'],
        ] as $label => $change) {
            $this->commRejects(fn () => DB::table('communication_messages')->where('id', $id)->update($change));
            $row = DB::table('communication_messages')->where('id', $id)->first();
            $this->assertSame(self::FP_A, trim((string) $row->request_fingerprint), $label);
            $this->assertSame(1, (int) $row->hash_key_version, $label);
        }
    }

    #[Test]
    public function the_metadata_is_immutable_through_the_scoped_model_query_builder_too(): void
    {
        $tenant = $this->commTenant();
        $id = $this->insertCommMessage($tenant->id, ['request_fingerprint' => self::FP_A, 'hash_key_version' => 1]);
        app(TenantContext::class)->set($tenant->id);

        $e = $this->commRejects(fn () => CommunicationMessage::query()->whereKey($id)->update(['hash_key_version' => 2]));

        $this->assertStringContainsString('identity columns are immutable', $e->getMessage());
    }

    #[Test]
    public function legitimate_progress_updates_remain_possible_with_metadata_present(): void
    {
        $tenant = $this->commTenant();
        $id = $this->insertCommMessage($tenant->id, ['request_fingerprint' => self::FP_A, 'hash_key_version' => 1]);

        $affected = DB::table('communication_messages')->where('id', $id)->update([
            'status' => 'sending', 'attempt_count' => 1, 'next_attempt_at' => null,
            'lease_token' => (string) \Illuminate\Support\Str::uuid(), 'lease_until' => now()->addMinutes(2)->toDateTimeString(),
        ]);

        $this->assertSame(1, $affected);
        $this->assertSame(self::FP_A, trim((string) DB::table('communication_messages')->where('id', $id)->value('request_fingerprint')));
    }

    #[Test]
    public function fingerprints_are_not_unique_and_never_cross_tenants(): void
    {
        $tenantA = $this->commTenant('a');
        $tenantB = $this->commTenant('b');

        // نفس البصمة داخل مستأجر وبين المستأجرين مقبولة: لا قيد فريد عليها ⇒ لا تكشف مستأجراً آخر.
        $this->insertCommMessage($tenantA->id, ['request_fingerprint' => self::FP_A, 'hash_key_version' => 1]);
        $this->insertCommMessage($tenantA->id, ['request_fingerprint' => self::FP_A, 'hash_key_version' => 1]);
        $messageB = $this->insertCommMessage($tenantB->id, ['request_fingerprint' => self::FP_A, 'hash_key_version' => 1]);

        app(TenantContext::class)->set($tenantA->id);
        $this->assertSame(2, CommunicationMessage::query()->where('request_fingerprint', self::FP_A)->count());
        $this->assertNull(CommunicationMessage::query()->find($messageB));
        $this->assertSame(0, CommunicationMessage::query()->whereKey($messageB)->update(['attempt_count' => 1]));
    }

    #[Test]
    public function no_index_was_added_for_the_new_columns(): void
    {
        $indexed = collect(['communication_messages', 'communication_message_attempts'])
            ->flatMap(fn (string $table) => Schema::getIndexes($table))
            ->flatMap(fn (array $index) => $index['columns'])
            ->all();

        $this->assertNotContains('request_fingerprint', $indexed);
        $this->assertNotContains('hash_key_version', $indexed);
    }

    #[Test]
    public function the_model_requires_metadata_on_new_rows_and_validates_its_shape(): void
    {
        $tenant = $this->commTenant();
        app(TenantContext::class)->set($tenant->id);
        $base = [
            'channel' => 'sms', 'classification' => 'transactional', 'template_key' => 't', 'source' => 's',
            'idempotency_hash' => hash('sha256', 'model-fp'), 'recipient_masked' => '+•••12', 'max_attempts' => 3,
            'expires_at' => now()->addHour(), 'next_attempt_at' => now(),
            'payload_encrypted' => ['address' => '+966500000009', 'variables' => []],
        ];

        $created = CommunicationMessage::create($base + ['request_fingerprint' => self::FP_A, 'hash_key_version' => 3]);
        $fresh = $created->fresh();
        $this->assertSame(3, $fresh->hash_key_version);
        $this->assertIsInt($fresh->hash_key_version);

        foreach ([
            'no metadata' => [],
            'fingerprint only' => ['request_fingerprint' => self::FP_A],
            'version only' => ['hash_key_version' => 1],
            'uppercase' => ['request_fingerprint' => str_repeat('A', 64), 'hash_key_version' => 1],
            'short' => ['request_fingerprint' => 'abc', 'hash_key_version' => 1],
            'version zero' => ['request_fingerprint' => self::FP_A, 'hash_key_version' => 0],
            'version too large' => ['request_fingerprint' => self::FP_A, 'hash_key_version' => 32768],
            'non numeric version' => ['request_fingerprint' => self::FP_A, 'hash_key_version' => 'x'],
        ] as $label => $metadata) {
            try {
                (new CommunicationMessage($metadata + $base + ['idempotency_hash' => hash('sha256', $label)]))->save();
                $this->fail("model must reject: {$label}");
            } catch (LogicException $e) {
                $this->assertStringNotContainsString(self::FP_A, $e->getMessage(), $label);
            }
        }
        $this->assertSame(1, DB::table('communication_messages')->count());
    }

    #[Test]
    public function the_model_rejects_changing_metadata_and_hides_the_fingerprint(): void
    {
        $tenant = $this->commTenant();
        $id = $this->insertCommMessage($tenant->id, ['request_fingerprint' => self::FP_A, 'hash_key_version' => 1]);
        app(TenantContext::class)->set($tenant->id);

        $message = CommunicationMessage::query()->findOrFail($id);
        $this->assertArrayNotHasKey('request_fingerprint', $message->toArray());
        $this->assertStringNotContainsString(self::FP_A, $message->toJson());

        $message->hash_key_version = 2;
        $this->expectException(LogicException::class);
        $message->save();
    }
}
