<?php

namespace Tests\Feature;

use App\Models\Tenant;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * أدوات مشتركة لاختبارات Schema الاتصالات (AWJ-COMMS-FOUNDATION-02-A): صفوف خام تمرّ بالقاعدة وحدها
 * (بلا حارس النموذج) وأشكال صالحة لكل حالة من `DeliveryStatus`.
 */
trait InteractsWithCommunicationSchema
{
    private function commTenant(string $label = 'comm'): Tenant
    {
        return Tenant::create([
            'name' => 'مستأجر اتصالات '.$label, 'slug' => 'comm-schema-'.$label.'-'.Str::random(8),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ]);
    }


    /**
     * يتوقّع رفض القاعدة للعملية. يلفّها بـsavepoint: على PostgreSQL يُجهض أي خطأ المعاملة المحيطة
     * (RefreshDatabase) فلا تعمل أي جملة بعده بلا هذا العزل.
     */
    private function commRejects(callable $operation): QueryException
    {
        try {
            DB::transaction($operation);
        } catch (QueryException $e) {
            return $e;
        }

        $this->fail('the database was expected to reject this operation');
    }

    private function commDriver(): string
    {
        return DB::connection()->getDriverName();
    }

    /**
     * صف رسالة خام صالح (queued لرسالة معاملات) قابل للتعديل بالـoverrides.
     *
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    private function commMessageRow(string $tenantId, array $overrides = []): array
    {
        $now = now()->toDateTimeString();

        return array_merge([
            'id' => (string) Str::uuid(),
            'tenant_id' => $tenantId,
            'channel' => 'sms',
            'classification' => 'transactional',
            'template_key' => 'invoice.issued',
            'source' => 'invoicing.issue',
            'idempotency_hash' => hash('sha256', $tenantId."\n".Str::random(16)),
            'recipient_masked' => '+•••12',
            'payload_encrypted' => 'ciphertext-placeholder',
            'status' => 'queued',
            'attempt_count' => 0,
            'max_attempts' => 3,
            'next_attempt_at' => $now,
            'expires_at' => now()->addHour()->toDateTimeString(),
            'lease_token' => null,
            'lease_until' => null,
            'last_error_code' => null,
            'accepted_at' => null,
            'receipt_deadline_at' => null,
            'settled_at' => null,
            'settled_reason' => null,
            'created_at' => $now,
            'updated_at' => $now,
        ], $overrides);
    }

    /** @param  array<string, mixed>  $overrides */
    private function insertCommMessage(string $tenantId, array $overrides = []): string
    {
        $row = $this->commMessageRow($tenantId, $overrides);
        DB::table('communication_messages')->insert($row);

        return $row['id'];
    }

    /** @return array<string, mixed> */
    private function commAttemptRow(string $tenantId, string $messageId, array $overrides = []): array
    {
        return array_merge([
            'id' => (string) Str::uuid(),
            'tenant_id' => $tenantId,
            'message_id' => $messageId,
            'attempt_no' => 1,
            'provider_key' => 'fake',
            'outcome' => 'started',
            'error_code' => null,
            'provider_message_id' => null,
            'started_at' => now()->toDateTimeString(),
            'finished_at' => null,
        ], $overrides);
    }

    /** @param  array<string, mixed>  $overrides */
    private function insertCommAttempt(string $tenantId, string $messageId, array $overrides = []): string
    {
        $row = $this->commAttemptRow($tenantId, $messageId, $overrides);
        DB::table('communication_message_attempts')->insert($row);

        return $row['id'];
    }

    /**
     * شكل صالح (يجتاز كل قواعد CHECK والحارس) لكل قيمة من `DeliveryStatus`.
     *
     * @return array<string, array<string, mixed>>
     */
    private function validShapesByStatus(): array
    {
        $now = now()->toDateTimeString();
        $later = now()->addDays(3)->toDateTimeString();
        $terminal = ['payload_encrypted' => null, 'next_attempt_at' => null, 'settled_at' => $now, 'settled_reason' => 'final_status'];

        return [
            'queued' => [],
            'retry_scheduled' => ['attempt_count' => 1],
            'sending' => ['attempt_count' => 1, 'next_attempt_at' => null, 'lease_token' => (string) Str::uuid(), 'lease_until' => $later],
            'failed_retryable' => ['attempt_count' => 1, 'next_attempt_at' => null],
            'accepted' => ['attempt_count' => 1, 'payload_encrypted' => null, 'next_attempt_at' => null, 'accepted_at' => $now, 'receipt_deadline_at' => $later],
            'delivered' => ['attempt_count' => 1, 'payload_encrypted' => null, 'next_attempt_at' => null, 'accepted_at' => $now, 'receipt_deadline_at' => $later],
            'unknown' => ['attempt_count' => 1, 'payload_encrypted' => null, 'next_attempt_at' => null, 'receipt_deadline_at' => $later, 'last_error_code' => 'unknown_outcome'],
            'read' => ['attempt_count' => 1] + $terminal,
            'failed_permanent' => ['attempt_count' => 1] + $terminal,
            'undeliverable' => ['attempt_count' => 1] + $terminal,
            'expired' => $terminal,
            'blocked_policy' => $terminal,
            'cancelled' => $terminal,
        ];
    }

    private function commIndexExists(string $name): bool
    {
        return $this->commDriver() === 'pgsql'
            ? DB::table('pg_indexes')->where('indexname', $name)->exists()
            : DB::table('sqlite_master')->where('type', 'index')->where('name', $name)->exists();
    }

    private function commIndexDefinition(string $name): string
    {
        return $this->commDriver() === 'pgsql'
            ? (string) DB::table('pg_indexes')->where('indexname', $name)->value('indexdef')
            : (string) DB::table('sqlite_master')->where('type', 'index')->where('name', $name)->value('sql');
    }

    /** @return list<string> */
    private function commTriggerNames(): array
    {
        if ($this->commDriver() === 'pgsql') {
            return DB::table('pg_trigger')
                ->where('tgisinternal', false)
                ->whereIn('tgname', ['comm_msg_identity_immutable', 'comm_attempt_guard'])
                ->pluck('tgname')->sort()->values()->all();
        }

        return DB::table('sqlite_master')->where('type', 'trigger')->where('name', 'like', 'comm_%')
            ->pluck('name')->sort()->values()->all();
    }
}
