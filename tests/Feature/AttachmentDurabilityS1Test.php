<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Employee;
use App\Models\EmployeeAttachment;
use App\Models\Expense;
use App\Models\ExpenseAttachment;
use App\Models\InvoiceNote;
use App\Models\InvoiceNoteAttachment;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Models\Partner;
use App\Models\Payment;
use App\Models\PaymentAllocation;
use App\Models\PaymentAttachment;
use App\Models\Purchase;
use App\Models\PurchaseAttachment;
use App\Services\AttachmentStorage;
use App\Services\AttachmentStorageException;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use RuntimeException;
use Tests\TestCase;

/**
 * AWJ-HORIZON-MEDIA-STORAGE S1 — مرفقات دائمة وذرّية الطلب (Master Plan §7/§9/§11).
 *
 * تغطّي معايير القبول: A-02 الدوام · A-03/A-08 التعايش وphoto_disk · A-04 تراجع العلم ·
 * A-05 ذرّية الطلب المالي (إنشاءً وتعديلاً) وإعادة المحاولة · A-06 put يرمي · A-07 عزل المستأجر ·
 * A-09 استبدال الصورة · A-10 عدم التصادم · A-15..A-17 الوصول.
 *
 * تشغيل: php artisan test --filter=AttachmentDurabilityS1Test
 */
class AttachmentDurabilityS1Test extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private FakeR2Bucket $bucket;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        $this->bucket = (new FakeR2Bucket())->install(true);
    }

    private function pdf(string $name = 'receipt.pdf'): UploadedFile
    {
        return UploadedFile::fake()->create($name, 50, 'application/pdf');
    }

    private function expenseAccountId(string $tenantId): string
    {
        app(TenantContext::class)->set($tenantId);

        return Account::where('code', '5130')->firstOrFail()->id;
    }

    private function postExpense(string $token, string $accountId, array $files, array $extra = [])
    {
        return $this->withToken($token)->post('/api/expenses', array_merge([
            'account_id' => $accountId, 'amount' => 100000, 'attachments' => $files,
        ], $extra), ['Accept' => 'application/json']);
    }

    private function accountingCounts(): array
    {
        return [JournalEntry::withoutGlobalScopes()->count(), JournalLine::withoutGlobalScopes()->count()];
    }

    // ───────────── A-02 الدوام + BC-1 ─────────────

    /** @test */
    public function an_expense_attachment_lands_on_r2_and_survives_losing_the_local_disk(): void
    {
        $auth = $this->registerTenant();
        $expense = $this->postExpense($auth['token'], $this->expenseAccountId($auth['tenant_id']), [$this->pdf()])
            ->assertCreated()['data'];

        $attachment = ExpenseAttachment::where('expense_id', $expense['id'])->firstOrFail();
        $this->assertSame('r2', $attachment->disk);
        $this->assertMatchesRegularExpression(
            '#^tenant/'.$auth['tenant_id'].'/expense-attachments/[0-9a-f-]{36}/[0-9a-f-]{36}\.pdf$#',
            $attachment->path,
        );
        $this->assertArrayHasKey($attachment->path, $this->bucket->objects);

        // محاكاة استبدال الحاوية: القرص المحلي يُمحى كلياً، والمرفق ما زال مقروءاً من R2.
        Storage::fake('local');

        $response = $this->withToken($auth['token'])
            ->get("/api/expenses/{$expense['id']}/attachments/{$attachment->id}")
            ->assertOk()->assertDownload('receipt.pdf');
        $response->assertHeader('X-Content-Type-Options', 'nosniff');
    }

    /** @test */
    public function with_the_flag_closed_new_writes_stay_local_exactly_as_before_and_r2_rows_still_read(): void
    {
        $auth = $this->registerTenant();
        $accountId = $this->expenseAccountId($auth['tenant_id']);

        $onR2 = $this->postExpense($auth['token'], $accountId, [$this->pdf('a.pdf')])->assertCreated()['data'];

        config()->set('attachments.r2.enabled', false);
        $local = $this->postExpense($auth['token'], $accountId, [$this->pdf('b.pdf')])->assertCreated()['data'];

        $rowR2 = ExpenseAttachment::where('expense_id', $onR2['id'])->firstOrFail();
        $rowLocal = ExpenseAttachment::where('expense_id', $local['id'])->firstOrFail();
        $this->assertSame('r2', $rowR2->disk);
        $this->assertSame('local', $rowLocal->disk);
        Storage::disk('local')->assertExists($rowLocal->path);
        $this->assertCount(1, $this->bucket->written, 'a closed flag must not write to R2');

        // A-04 / BC-2: إغلاق العلم لا يُضيّع ما كُتب على R2، ولا يغيّر قراءة المحلي (BC-1).
        $this->withToken($auth['token'])->get("/api/expenses/{$onR2['id']}/attachments/{$rowR2->id}")->assertOk();
        $this->withToken($auth['token'])->get("/api/expenses/{$local['id']}/attachments/{$rowLocal->id}")->assertOk();
    }

    /** @test */
    public function the_same_file_uploaded_twice_gets_two_distinct_keys(): void
    {
        $auth = $this->registerTenant();
        $accountId = $this->expenseAccountId($auth['tenant_id']);
        $same = fn () => UploadedFile::fake()->createWithContent('same.pdf', '%PDF-1.4 same bytes');

        $this->postExpense($auth['token'], $accountId, [$same(), $same()])->assertCreated();

        $keys = $this->bucket->written;
        $this->assertCount(2, $keys);
        $this->assertCount(2, array_unique($keys));
    }

    // ───────────── A-05 ذرّية الطلب المالي ─────────────

    /** @test */
    public function a_failed_expense_create_leaves_no_parent_row_object_or_ledger_and_a_retry_creates_exactly_one(): void
    {
        $auth = $this->registerTenant();
        $accountId = $this->expenseAccountId($auth['tenant_id']);
        $before = $this->accountingCounts();

        // الملف الثاني من ثلاثة يفشل في الكتابة.
        $this->bucket->failPutAttempts = [2];
        $this->postExpense($auth['token'], $accountId, [$this->pdf('1.pdf'), $this->pdf('2.pdf'), $this->pdf('3.pdf')])
            ->assertStatus(503)->assertJsonPath('code', 'storage_unavailable');

        $this->assertSame(0, Expense::count(), 'no financial parent may survive a failed upload');
        $this->assertSame(0, ExpenseAttachment::count());
        $this->assertSame([], $this->bucket->keys(), 'the first file must be compensated');
        $this->assertSame($before, $this->accountingCounts());

        // إعادة الطلب = محاولة أولى نظيفة.
        $this->bucket->failPutAttempts = [];
        $this->postExpense($auth['token'], $accountId, [$this->pdf('1.pdf'), $this->pdf('2.pdf'), $this->pdf('3.pdf')])
            ->assertCreated();
        $this->assertSame(1, Expense::count());
        $this->assertSame(3, ExpenseAttachment::count());
        $this->assertCount(3, $this->bucket->keys());
    }

    /** @test */
    public function a_database_failure_after_the_files_are_written_rolls_back_the_parent_and_deletes_the_objects(): void
    {
        $auth = $this->registerTenant();
        $accountId = $this->expenseAccountId($auth['tenant_id']);

        ExpenseAttachment::creating(function () {
            throw new RuntimeException('simulated db failure while attaching');
        });

        try {
            $this->withoutExceptionHandling();
            $this->postExpense($auth['token'], $accountId, [$this->pdf()]);
            $this->fail('the request must fail');
        } catch (RuntimeException $e) {
            $this->assertSame('simulated db failure while attaching', $e->getMessage());
        }

        $this->assertSame(0, Expense::count(), 'the parent must roll back together with its attachment rows');
        $this->assertSame(0, ExpenseAttachment::count());
        $this->assertSame([], $this->bucket->keys(), 'objects written before the failure must be compensated');
    }

    /** @test */
    public function a_failed_draft_expense_update_leaves_the_draft_exactly_as_it_was(): void
    {
        $auth = $this->registerTenant();
        $accountId = $this->expenseAccountId($auth['tenant_id']);
        $created = $this->postExpense($auth['token'], $accountId, [$this->pdf('keep.pdf')], ['description' => 'الأصلي'])
            ->assertCreated()['data'];
        $objectsBefore = $this->bucket->keys();

        $this->bucket->failPutAttempts = [$this->bucket->putAttempts + 2];
        $this->withToken($auth['token'])->post("/api/expenses/{$created['id']}", [
            '_method' => 'PUT', 'account_id' => $accountId, 'amount' => 999900, 'description' => 'معدَّل',
            'attachments' => [$this->pdf('n1.pdf'), $this->pdf('n2.pdf')],
        ], ['Accept' => 'application/json'])->assertStatus(503);

        $fresh = Expense::findOrFail($created['id']);
        $this->assertSame(100000, (int) $fresh->amount);
        $this->assertSame('الأصلي', $fresh->description);
        $this->assertSame(1, ExpenseAttachment::where('expense_id', $created['id'])->count());
        $this->assertSame($objectsBefore, $this->bucket->keys());
    }

    /** @test */
    public function a_failed_payment_create_leaves_no_payment_allocation_object_or_ledger_and_a_retry_creates_one(): void
    {
        $auth = $this->registerTenant();
        $partnerId = $this->withToken($auth['token'])->postJson('/api/partners', ['name' => 'عميل', 'type' => 'customer'])
            ->assertCreated()['data']['id'];
        $invoice = $this->withToken($auth['token'])->postJson('/api/invoices', [
            'partner_id' => $partnerId, 'payment_type' => 'credit',
            'items' => [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ])->assertCreated()['data'];
        $this->withToken($auth['token'])->postJson("/api/invoices/{$invoice['id']}/post")->assertOk();
        $before = $this->accountingCounts();

        $payload = fn () => [
            'partner_id' => $partnerId, 'direction' => 'received', 'method' => 'cash', 'amount' => 115000,
            'allocations' => [['invoice_id' => $invoice['id'], 'amount' => 115000]],
            'attachments' => [$this->pdf('p1.pdf'), $this->pdf('p2.pdf')],
        ];

        $this->bucket->failPutAttempts = [2];
        $this->withToken($auth['token'])->post('/api/payments', $payload(), ['Accept' => 'application/json'])
            ->assertStatus(503);

        $this->assertSame(0, Payment::count());
        $this->assertSame(0, PaymentAllocation::count());
        $this->assertSame(0, PaymentAttachment::count());
        $this->assertSame([], $this->bucket->keys());
        $this->assertSame($before, $this->accountingCounts());

        $this->bucket->failPutAttempts = [];
        $this->withToken($auth['token'])->post('/api/payments', $payload(), ['Accept' => 'application/json'])
            ->assertCreated();
        $this->assertSame(1, Payment::count());
        $this->assertSame(1, PaymentAllocation::count());
        $this->assertSame(2, PaymentAttachment::count());
    }

    /** @test */
    public function a_database_failure_while_attaching_to_a_payment_rolls_back_the_payment_and_its_allocations(): void
    {
        $auth = $this->registerTenant();
        $partnerId = $this->withToken($auth['token'])->postJson('/api/partners', ['name' => 'عميل', 'type' => 'customer'])
            ->assertCreated()['data']['id'];
        $invoice = $this->withToken($auth['token'])->postJson('/api/invoices', [
            'partner_id' => $partnerId, 'payment_type' => 'credit',
            'items' => [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ])->assertCreated()['data'];
        $this->withToken($auth['token'])->postJson("/api/invoices/{$invoice['id']}/post")->assertOk();

        PaymentAttachment::creating(function () {
            throw new RuntimeException('simulated db failure while attaching');
        });

        $this->withoutExceptionHandling();
        try {
            $this->withToken($auth['token'])->post('/api/payments', [
                'partner_id' => $partnerId, 'direction' => 'received', 'method' => 'cash', 'amount' => 115000,
                'allocations' => [['invoice_id' => $invoice['id'], 'amount' => 115000]],
                'attachments' => [$this->pdf()],
            ], ['Accept' => 'application/json']);
            $this->fail('the request must fail');
        } catch (RuntimeException) {
        }

        $this->assertSame(0, Payment::count());
        $this->assertSame(0, PaymentAllocation::count());
        $this->assertSame([], $this->bucket->keys());
    }

    /** @test */
    public function a_failed_invoice_note_leaves_no_note_row_or_object_and_a_retry_creates_one(): void
    {
        $auth = $this->registerTenant();
        $partnerId = $this->withToken($auth['token'])->postJson('/api/partners', ['name' => 'عميل', 'type' => 'customer'])
            ->assertCreated()['data']['id'];
        $invoice = $this->withToken($auth['token'])->postJson('/api/invoices', [
            'partner_id' => $partnerId, 'payment_type' => 'credit',
            'items' => [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ])->assertCreated()['data'];

        $send = fn () => $this->withToken($auth['token'])->post("/api/invoices/{$invoice['id']}/notes", [
            'body' => 'ملاحظة', 'attachments' => [$this->pdf('1.pdf'), $this->pdf('2.pdf')],
        ]);

        $this->bucket->failPutAttempts = [2];
        $send()->assertStatus(503);
        $this->assertSame(0, InvoiceNote::count());
        $this->assertSame(0, InvoiceNoteAttachment::count());
        $this->assertSame([], $this->bucket->keys());

        $this->bucket->failPutAttempts = [];
        $send()->assertCreated();
        $this->assertSame(1, InvoiceNote::count());
        $this->assertSame(2, InvoiceNoteAttachment::count());
        $note = InvoiceNoteAttachment::firstOrFail();
        $this->assertSame('r2', $note->disk);
        $this->withToken($auth['token'])
            ->get("/api/invoices/{$invoice['id']}/notes/{$note->invoice_note_id}/attachments/{$note->id}/download")
            ->assertOk()->assertHeader('X-Content-Type-Options', 'nosniff');
    }

    /** @test */
    public function purchase_attachments_are_all_or_nothing(): void
    {
        $auth = $this->registerTenant();
        $supplier = $this->withToken($auth['token'])->postJson('/api/partners', ['name' => 'مورد', 'type' => 'supplier'])
            ->assertCreated()['data']['id'];
        $product = $this->withToken($auth['token'])->postJson('/api/products', [
            'name' => 'إسمنت', 'sku' => 'CEM-1', 'type' => 'good', 'sale_price' => 100000, 'purchase_price' => 100000,
        ])->assertCreated()['data']['id'];
        $purchase = $this->withToken($auth['token'])->postJson('/api/purchases', [
            'partner_id' => $supplier, 'items' => [['product_id' => $product, 'quantity' => 1, 'unit_price' => 100000]],
        ])->assertCreated()['data'];

        $this->bucket->failPutAttempts = [2];
        $this->withToken($auth['token'])->post("/api/purchases/{$purchase['id']}/attachments", [
            'attachments' => [$this->pdf('1.pdf'), $this->pdf('2.pdf')],
        ])->assertStatus(503);
        $this->assertSame(0, PurchaseAttachment::count());
        $this->assertSame([], $this->bucket->keys());

        $this->bucket->failPutAttempts = [];
        $this->withToken($auth['token'])->post("/api/purchases/{$purchase['id']}/attachments", [
            'attachments' => [$this->pdf('1.pdf')],
        ])->assertCreated();
        $row = PurchaseAttachment::firstOrFail();
        $this->assertSame('r2', $row->disk);
        $this->withToken($auth['token'])
            ->get("/api/purchases/{$purchase['id']}/attachments/{$row->id}/download")->assertOk();

        // حذف المرفق يمحو الكائن.
        $this->withToken($auth['token'])->deleteJson("/api/purchases/{$purchase['id']}/attachments/{$row->id}")->assertOk();
        $this->assertSame([], $this->bucket->keys());
    }

    // ───────────── A-06 put يرمي ─────────────

    /** @test */
    public function put_throws_when_the_local_write_fails_instead_of_returning_false_silently(): void
    {
        $this->registerTenant();
        config()->set('attachments.r2.enabled', false);
        $blocker = tempnam(sys_get_temp_dir(), 'blk');
        config()->set('filesystems.disks.local.root', $blocker); // جذرٌ هو ملفّ عادي ⇒ تفشل الكتابة
        app('filesystem')->forgetDisk('local');

        try {
            $this->expectException(AttachmentStorageException::class);
            app(AttachmentStorage::class)->put(AttachmentStorage::DOMAIN_EXPENSE, 'r', $this->pdf(), 'expenses/r');
        } finally {
            @unlink($blocker);
        }
    }

    /** @test */
    public function put_throws_when_r2_fails(): void
    {
        $this->registerTenant();
        $this->bucket->failPutAttempts = [1];

        $this->expectException(AttachmentStorageException::class);
        app(AttachmentStorage::class)->put(AttachmentStorage::DOMAIN_EXPENSE, 'r', $this->pdf(), 'expenses/r');
    }

    // ───────────── A-07 عزل المستأجر ─────────────

    /** @test */
    public function another_tenants_attachment_cannot_be_read_or_deleted_and_keys_differ_per_tenant(): void
    {
        $a = $this->registerTenant('tenant-a', 'a@a.test');
        $expenseA = $this->postExpense($a['token'], $this->expenseAccountId($a['tenant_id']), [$this->pdf()])
            ->assertCreated()['data'];
        $rowA = ExpenseAttachment::where('expense_id', $expenseA['id'])->firstOrFail();

        $b = $this->registerTenant('tenant-b', 'b@b.test');
        $expenseB = $this->postExpense($b['token'], $this->expenseAccountId($b['tenant_id']), [$this->pdf()])
            ->assertCreated()['data'];
        $rowB = ExpenseAttachment::where('expense_id', $expenseB['id'])->firstOrFail();

        $this->assertStringStartsWith("tenant/{$a['tenant_id']}/", $rowA->path);
        $this->assertStringStartsWith("tenant/{$b['tenant_id']}/", $rowB->path);

        // B لا يصل إلى مرفق A عبر أي معرّف.
        $this->withToken($b['token'])->get("/api/expenses/{$expenseA['id']}/attachments/{$rowA->id}")->assertNotFound();
        $this->withToken($b['token'])->get("/api/expenses/{$expenseB['id']}/attachments/{$rowA->id}")->assertNotFound();

        // وحتى لو وُجد مسارٌ لمستأجر آخر في صف، فالخدمة لا تحلّه ولا تحذفه (حاجز ثانٍ).
        app(TenantContext::class)->set($b['tenant_id']);
        $storage = app(AttachmentStorage::class);
        $this->assertFalse($storage->exists('r2', $rowA->path));
        try {
            $storage->delete('r2', $rowA->path);
            $this->fail('deleting another tenant object must throw');
        } catch (AttachmentStorageException) {
        }
        $this->assertArrayHasKey($rowA->path, $this->bucket->objects);
    }

    // ───────────── A-15..A-17 الوصول ─────────────

    /** @test */
    public function an_unauthenticated_download_is_rejected_before_any_storage_read(): void
    {
        $auth = $this->registerTenant();
        $expense = $this->postExpense($auth['token'], $this->expenseAccountId($auth['tenant_id']), [$this->pdf()])
            ->assertCreated()['data'];
        $row = ExpenseAttachment::where('expense_id', $expense['id'])->firstOrFail();

        $this->bucket->getCalls = 0;
        $this->flushHeaders()->getJson("/api/expenses/{$expense['id']}/attachments/{$row->id}")->assertUnauthorized();
        $this->assertSame(0, $this->bucket->getCalls);
    }

    // ───────────── الموظفون: A-03 / A-08 / A-09 + محو قبل الإزالة ─────────────

    private function employee(string $token): array
    {
        return $this->withToken($token)->postJson('/api/employees', ['name' => 'موظف', 'basic_salary' => 500000])
            ->assertCreated()['data'];
    }

    /** @test */
    public function employee_photo_disk_null_local_and_r2_all_read_side_by_side(): void
    {
        $auth = $this->registerTenant();
        $legacy = $this->employee($auth['token']);   // photo_disk = null (صف قديم)
        $explicit = $this->employee($auth['token']); // local صريح
        $durable = $this->employee($auth['token']);  // r2

        // قديم: يُكتب مباشرة كما كان قبل الأفق (photo_path بلا photo_disk).
        Storage::disk('local')->put('employees/legacy/old.jpg', 'legacy-bytes');
        app(TenantContext::class)->set($auth['tenant_id']);
        $row = Employee::findOrFail($legacy['id']);
        $row->photo_path = 'employees/legacy/old.jpg';
        $row->save();
        $this->assertNull($row->fresh()->photo_disk);

        config()->set('attachments.r2.enabled', false);
        $this->withToken($auth['token'])->postJson("/api/employees/{$explicit['id']}/photo", [
            'photo' => UploadedFile::fake()->image('a.jpg'),
        ])->assertOk();
        $this->assertSame('local', Employee::findOrFail($explicit['id'])->photo_disk);

        config()->set('attachments.r2.enabled', true);
        $this->withToken($auth['token'])->postJson("/api/employees/{$durable['id']}/photo", [
            'photo' => UploadedFile::fake()->image('b.jpg'),
        ])->assertOk();
        $stored = Employee::findOrFail($durable['id']);
        $this->assertSame('r2', $stored->photo_disk);
        $this->assertStringStartsWith("tenant/{$auth['tenant_id']}/employee-photo/{$durable['id']}/", $stored->photo_path);

        foreach ([$legacy, $explicit, $durable] as $emp) {
            $this->withToken($auth['token'])->get("/api/employees/{$emp['id']}/photo")
                ->assertOk()->assertHeader('X-Content-Type-Options', 'nosniff');
        }
    }

    /** @test */
    public function a_failed_photo_replacement_does_not_lose_the_existing_photo(): void
    {
        $auth = $this->registerTenant();
        $emp = $this->employee($auth['token']);

        $this->withToken($auth['token'])->postJson("/api/employees/{$emp['id']}/photo", [
            'photo' => UploadedFile::fake()->image('first.jpg'),
        ])->assertOk();
        $first = Employee::findOrFail($emp['id']);
        $firstPath = $first->photo_path;

        $this->bucket->failPutAttempts = [$this->bucket->putAttempts + 1];
        $this->withToken($auth['token'])->postJson("/api/employees/{$emp['id']}/photo", [
            'photo' => UploadedFile::fake()->image('second.jpg'),
        ])->assertStatus(503);

        $after = Employee::findOrFail($emp['id']);
        $this->assertSame($firstPath, $after->photo_path);
        $this->assertArrayHasKey($firstPath, $this->bucket->objects, 'the old photo must survive a failed replacement');
        $this->withToken($auth['token'])->get("/api/employees/{$emp['id']}/photo")->assertOk();

        // الاستبدال الناجح يُثبّت الجديد ثم يمحو القديم.
        $this->bucket->failPutAttempts = [];
        $this->withToken($auth['token'])->postJson("/api/employees/{$emp['id']}/photo", [
            'photo' => UploadedFile::fake()->image('third.jpg'),
        ])->assertOk();
        $this->assertArrayNotHasKey($firstPath, $this->bucket->objects);
        $this->assertCount(1, $this->bucket->keys());
    }

    /** @test */
    public function employee_attachments_are_all_or_nothing_and_deletion_erases_the_object_first(): void
    {
        $auth = $this->registerTenant();
        $emp = $this->employee($auth['token']);

        $this->bucket->failPutAttempts = [2];
        $this->withToken($auth['token'])->postJson("/api/employees/{$emp['id']}/attachments", [
            'attachments' => [$this->pdf('1.pdf'), $this->pdf('2.pdf')],
        ])->assertStatus(503);
        $this->assertSame(0, EmployeeAttachment::count());
        $this->assertSame([], $this->bucket->keys());

        $this->bucket->failPutAttempts = [];
        $this->withToken($auth['token'])->postJson("/api/employees/{$emp['id']}/attachments", [
            'attachments' => [$this->pdf('1.pdf')],
        ])->assertCreated();
        $row = EmployeeAttachment::firstOrFail();
        $this->assertSame('r2', $row->disk);

        // فشل المحو ⇒ الصف باقٍ (قابل لإعادة المحاولة) ولا يُترك كائنٌ يتيم.
        $this->bucket->failDeletes = true;
        $this->withToken($auth['token'])->deleteJson("/api/employees/{$emp['id']}/attachments/{$row->id}")
            ->assertStatus(503);
        $this->assertSame(1, EmployeeAttachment::count());

        $this->bucket->failDeletes = false;
        $this->withToken($auth['token'])->deleteJson("/api/employees/{$emp['id']}/attachments/{$row->id}")->assertOk();
        $this->assertSame(0, EmployeeAttachment::count());
        $this->assertSame([], $this->bucket->keys());
    }

    /** @test */
    public function deleting_an_employee_erases_photo_and_attachment_objects(): void
    {
        $auth = $this->registerTenant();
        $emp = $this->employee($auth['token']);
        $this->withToken($auth['token'])->postJson("/api/employees/{$emp['id']}/photo", [
            'photo' => UploadedFile::fake()->image('p.jpg'),
        ])->assertOk();
        $this->withToken($auth['token'])->postJson("/api/employees/{$emp['id']}/attachments", [
            'attachments' => [$this->pdf()],
        ])->assertCreated();
        $this->assertCount(2, $this->bucket->keys());

        $this->withToken($auth['token'])->deleteJson("/api/employees/{$emp['id']}")->assertOk();
        $this->assertSame([], $this->bucket->keys());
    }

    /** @test */
    public function an_accounting_attachment_delete_removes_the_row_even_if_object_erasure_fails(): void
    {
        $auth = $this->registerTenant();
        $accountId = $this->expenseAccountId($auth['tenant_id']);
        $expense = $this->postExpense($auth['token'], $accountId, [$this->pdf()])->assertCreated()['data'];

        $this->bucket->failDeletes = true;
        $this->withToken($auth['token'])->deleteJson("/api/expenses/{$expense['id']}")->assertOk();

        // المحاسبة تفضّل بقاء السجلّ سليماً: الصف حُذف والفشل سُجّل.
        $this->assertSame(0, Expense::count());
        $this->assertSame(0, ExpenseAttachment::count());
    }
}
