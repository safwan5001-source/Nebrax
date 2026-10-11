<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Expense;
use App\Models\ExpenseAttachment;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Models\Payment;
use App\Models\PaymentAllocation;
use App\Models\User;
use App\Models\UserRequestIdempotencyKey;
use App\Support\UserRequestIdempotency;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * AWJ-HORIZON-MEDIA-STORAGE S3 — Idempotency-Key اختياري لإنشاء المصروف والدفعة.
 *
 * يغطّي: انقطاع الاستجابة بعد نجاح الحفظ (إعادة الطلب لا تُنشئ سجلاً ثانياً ولا قيداً) · عمليتان
 * مشروعتان بمفتاحين · تعارض الحمولة · طلب متزامن قيد التنفيذ · إيجار منتهٍ · تحرير المفتاح عند
 * الفشل (422 / فشل رفع) · عزل المستخدم والمستأجر · التوافق الخلفي عند غياب الترويسة.
 *
 * تشغيل: php artisan test --filter=UserRequestIdempotencyTest
 */
class UserRequestIdempotencyTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function accountId(string $tenantId): string
    {
        app(TenantContext::class)->set($tenantId);

        return Account::where('code', '5130')->firstOrFail()->id;
    }

    private function expense(string $token, string $accountId, ?string $key, array $extra = [])
    {
        $headers = ['Accept' => 'application/json'] + ($key !== null ? ['Idempotency-Key' => $key] : []);

        return $this->withToken($token)->postJson('/api/expenses', array_merge([
            'account_id' => $accountId, 'amount' => 100000, 'description' => 'مصروف',
        ], $extra), $headers);
    }

    private function counts(): array
    {
        return [
            JournalEntry::withoutGlobalScopes()->count(), JournalLine::withoutGlobalScopes()->count(),
        ];
    }

    /** @test */
    public function without_the_header_behaviour_is_unchanged(): void
    {
        $auth = $this->registerTenant();
        $account = $this->accountId($auth['tenant_id']);

        $this->expense($auth['token'], $account, null)->assertCreated();
        $this->expense($auth['token'], $account, null)->assertCreated();

        $this->assertSame(2, Expense::count());
        $this->assertSame(0, UserRequestIdempotencyKey::withoutGlobalScopes()->count());
    }

    /** @test */
    public function a_retry_after_a_lost_response_replays_the_first_result_without_a_second_record(): void
    {
        $auth = $this->registerTenant();
        $account = $this->accountId($auth['tenant_id']);
        $before = $this->counts();

        $first = $this->expense($auth['token'], $account, 'key-expense-0001')->assertCreated();
        // العميل لم يستلم الاستجابة فأعاد الطلب نفسه بالمفتاح نفسه.
        $second = $this->expense($auth['token'], $account, 'key-expense-0001')
            ->assertCreated()->assertHeader('Idempotency-Replayed', 'true');

        $this->assertSame($first['data']['id'], $second['data']['id']);
        $this->assertSame(1, Expense::count(), 'a replay must not create a second expense');
        $this->assertSame($before, $this->counts(), 'a replay must not create ledger entries');
    }

    /** @test */
    public function two_distinct_keys_are_two_legitimate_operations(): void
    {
        $auth = $this->registerTenant();
        $account = $this->accountId($auth['tenant_id']);

        $a = $this->expense($auth['token'], $account, 'key-expense-A001')->assertCreated();
        $b = $this->expense($auth['token'], $account, 'key-expense-B001')->assertCreated();

        $this->assertNotSame($a['data']['id'], $b['data']['id']);
        $this->assertSame(2, Expense::count());
    }

    /** @test */
    public function the_same_key_with_a_different_payload_is_a_conflict(): void
    {
        $auth = $this->registerTenant();
        $account = $this->accountId($auth['tenant_id']);

        $this->expense($auth['token'], $account, 'key-expense-0002')->assertCreated();
        $this->expense($auth['token'], $account, 'key-expense-0002', ['amount' => 250000])
            ->assertStatus(409)->assertJsonPath('code', 'idempotency_conflict');

        $this->assertSame(1, Expense::count());
    }

    /** @test */
    public function a_concurrent_request_holding_the_key_is_rejected_without_execution(): void
    {
        $auth = $this->registerTenant();
        $account = $this->accountId($auth['tenant_id']);
        $payload = ['account_id' => $account, 'amount' => 100000, 'description' => 'مصروف'];
        $user = User::where('email', 'owner@acme.test')->firstOrFail();

        // يحاكي طلباً آخر بالمفتاح نفسه ما زال في الطيران (بصمة مطابقة وإيجار ساري).
        $fingerprint = UserRequestIdempotency::fingerprint(Request::create('/api/expenses', 'POST', $payload));
        UserRequestIdempotencyKey::create([
            'tenant_id' => $auth['tenant_id'], 'user_id' => $user->id,
            'key_hash' => UserRequestIdempotency::hashKey('key-expense-0003'), 'method' => 'POST',
            'request_fingerprint' => $fingerprint, 'status' => 'in_progress',
            'locked_at' => now(), 'expires_at' => now()->addMinutes(5),
        ]);

        $this->expense($auth['token'], $account, 'key-expense-0003')
            ->assertStatus(409)->assertJsonPath('code', 'idempotency_in_progress');
        $this->assertSame(0, Expense::count());
    }

    /** @test */
    public function an_expired_lease_from_a_crashed_request_is_reclaimed(): void
    {
        $auth = $this->registerTenant();
        $account = $this->accountId($auth['tenant_id']);
        $user = User::where('email', 'owner@acme.test')->firstOrFail();

        UserRequestIdempotencyKey::create([
            'tenant_id' => $auth['tenant_id'], 'user_id' => $user->id,
            'key_hash' => UserRequestIdempotency::hashKey('key-expense-0004'), 'method' => 'POST',
            'request_fingerprint' => str_repeat('a', 64), 'status' => 'in_progress',
            'locked_at' => now()->subHour(), 'expires_at' => now()->subMinute(),
        ]);

        $this->expense($auth['token'], $account, 'key-expense-0004')->assertCreated();
        $this->assertSame(1, Expense::count());
    }

    /** @test */
    public function a_validation_failure_releases_the_key_for_a_corrected_retry(): void
    {
        $auth = $this->registerTenant();
        $account = $this->accountId($auth['tenant_id']);

        $this->expense($auth['token'], $account, 'key-expense-0005', ['amount' => -5])->assertStatus(422);
        $this->assertSame(0, UserRequestIdempotencyKey::withoutGlobalScopes()->count());

        $this->expense($auth['token'], $account, 'key-expense-0005')->assertCreated();
        $this->assertSame(1, Expense::count());
    }

    /** @test */
    public function an_invalid_key_is_rejected_before_any_work(): void
    {
        $auth = $this->registerTenant();
        $account = $this->accountId($auth['tenant_id']);

        $this->expense($auth['token'], $account, 'short')->assertStatus(400)->assertJsonPath('code', 'invalid_idempotency_key');
        $this->assertSame(0, Expense::count());
    }

    /** @test */
    public function keys_are_scoped_per_user_and_per_tenant(): void
    {
        $a = $this->registerTenant('tenant-a', 'a@a.test');
        $accountA = $this->accountId($a['tenant_id']);
        $adminA = $this->tokenForRole($a['tenant_id'], 'admin', 'admin@a.test');
        $b = $this->registerTenant('tenant-b', 'b@b.test');
        $accountB = $this->accountId($b['tenant_id']);

        $this->expense($a['token'], $accountA, 'shared-key-0001')->assertCreated();
        // مستخدم آخر في المستأجر نفسه: مفتاحه مستقل ⇒ عملية جديدة، لا إعادة تشغيل.
        $this->expense($adminA, $accountA, 'shared-key-0001')->assertCreated()->assertHeaderMissing('Idempotency-Replayed');
        // مستأجر آخر: لا يرى مفتاح الأول ولا استجابته.
        $this->expense($b['token'], $accountB, 'shared-key-0001')->assertCreated()->assertHeaderMissing('Idempotency-Replayed');

        $this->assertSame(3, Expense::withoutGlobalScopes()->count());
    }

    /** @test */
    public function a_failed_attachment_upload_releases_the_key_so_the_retry_creates_exactly_one_expense(): void
    {
        Storage::fake('local');
        $bucket = (new FakeR2Bucket())->install(true);
        $auth = $this->registerTenant();
        $account = $this->accountId($auth['tenant_id']);

        $send = fn () => $this->withToken($auth['token'])->post('/api/expenses', [
            'account_id' => $account, 'amount' => 100000,
            'attachments' => [
                UploadedFile::fake()->createWithContent('a.pdf', '%PDF-1.4 a'),
                UploadedFile::fake()->createWithContent('b.pdf', '%PDF-1.4 b'),
            ],
        ], ['Accept' => 'application/json', 'Idempotency-Key' => 'key-upload-0001']);

        $bucket->failPutAttempts = [2];
        $send()->assertStatus(503);
        $this->assertSame(0, Expense::count());
        $this->assertSame([], $bucket->keys());
        $this->assertSame(0, UserRequestIdempotencyKey::withoutGlobalScopes()->count(), 'the key must be released on failure');

        // إعادة الطلب نفسه (multipart بحدّ فاصل جديد) = محاولة أولى نظيفة.
        $bucket->failPutAttempts = [];
        $first = $send()->assertCreated();
        $this->assertSame(1, Expense::count());
        $this->assertSame(2, ExpenseAttachment::count());

        // ثم ضاعت الاستجابة: الإعادة تُعيد النتيجة المخزَّنة ولا تكتب ملفات ثانية.
        $putsBefore = $bucket->putAttempts;
        $replay = $send()->assertCreated()->assertHeader('Idempotency-Replayed', 'true');
        $this->assertSame($first['data']['id'], $replay['data']['id']);
        $this->assertSame($putsBefore, $bucket->putAttempts, 'a replay must not touch storage');
        $this->assertSame(1, Expense::count());
        $this->assertSame(2, ExpenseAttachment::count());
    }

    /** @test */
    public function a_payment_retry_does_not_duplicate_the_payment_allocation_or_ledger(): void
    {
        $auth = $this->registerTenant();
        $partner = $this->withToken($auth['token'])->postJson('/api/partners', ['name' => 'عميل', 'type' => 'customer'])
            ->assertCreated()['data']['id'];
        $invoice = $this->withToken($auth['token'])->postJson('/api/invoices', [
            'partner_id' => $partner, 'payment_type' => 'credit',
            'items' => [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ])->assertCreated()['data'];
        $this->withToken($auth['token'])->postJson("/api/invoices/{$invoice['id']}/post")->assertOk();
        $before = $this->counts();

        $send = fn () => $this->withToken($auth['token'])->postJson('/api/payments', [
            'partner_id' => $partner, 'direction' => 'received', 'method' => 'cash', 'amount' => 115000,
            'allocations' => [['invoice_id' => $invoice['id'], 'amount' => 115000]],
        ], ['Idempotency-Key' => 'key-payment-0001']);

        $first = $send()->assertCreated();
        $replay = $send()->assertCreated()->assertHeader('Idempotency-Replayed', 'true');

        $this->assertSame($first['data']['id'], $replay['data']['id']);
        $this->assertSame(1, Payment::count());
        $this->assertSame(1, PaymentAllocation::count());
        $this->assertSame($before, $this->counts());
    }
}
