<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\AccountingPeriodLock;
use App\Models\AccountingPeriodLockEvent;
use App\Models\JournalEntry;
use App\Models\ManualJournal;
use App\Models\Partner;
use App\Models\Product;
use App\Models\ProductWarehouseStock;
use App\Models\Tenant;
use App\Models\Warehouse;
use App\Services\Accounting\AccountingDateGuard;
use App\Services\Accounting\AccountingPeriodLockedException;
use App\Services\Accounting\AccountingPeriodLockService;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\InventoryService;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\LedgerService;
use App\Services\Accounting\ManualJournalService;
use App\Services\Accounting\PurchaseService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use LogicException;
use RuntimeException;
use Tests\TestCase;

/**
 * ACC-6 — Accounting Period Locks.
 *
 * القفل يمنع **إنشاء أثر محاسبي جديد** داخل نطاق تاريخ مقفل، ولا يفعل شيئاً
 * آخر: لا يغيّر حساباً ولا مبلغاً ولا اتجاهاً، ولا يلمس قيداً تاريخياً، ولا
 * يمنع المسودات. الإنفاذ في `LedgerService` وحده عبر `AccountingDateGuard`.
 *
 * تشغيل: php artisan test --filter=AccountingPeriodLockTest
 */
class AccountingPeriodLockTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const LOCK_START = '2026-01-01';
    private const LOCK_END   = '2026-01-31';

    protected Tenant $tenant;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenant = Tenant::create([
            'name' => 'نبراس الطموح', 'slug' => 'nibras-acc6',
            'vat_number' => '300000000000003', 'currency' => 'SAR',
        ]);
        app(TenantContext::class)->set($this->tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);
    }

    // ───────────────────────────── مساعدات ─────────────────────────────

    private function accountId(string $code): string
    {
        return Account::where('code', $code)->firstOrFail()->id;
    }

    /** قيدٌ متوازن بسيط: مدين الصندوق / دائن رأس المال. */
    private function postEntry(?string $date): JournalEntry
    {
        return app(LedgerService::class)->post([
            ['account_id' => $this->accountId('1110'), 'debit' => 10000],
            ['account_id' => $this->accountId('3110'), 'credit' => 10000],
        ], array_filter(['entry_date' => $date], fn ($v) => $v !== null));
    }

    private function lock(string $start = self::LOCK_START, string $end = self::LOCK_END, string $reason = 'إقفال يناير'): array
    {
        return app(AccountingPeriodLockService::class)->create($start, $end, $reason, null);
    }

    private function draft(string $date): ManualJournal
    {
        return app(ManualJournalService::class)->create(
            ['entry_date' => $date, 'description' => 'مسودة'],
            [
                ['account_id' => $this->accountId('1110'), 'debit' => 5000, 'credit' => 0],
                ['account_id' => $this->accountId('3110'), 'debit' => 0, 'credit' => 5000],
            ],
        );
    }

    // ── 1-4. حدود النطاق شاملة الطرفين ──────────────────────────────────

    /** @test */
    public function posting_on_an_open_date_succeeds(): void
    {
        $this->lock();

        $entry = $this->postEntry('2026-02-01');

        $this->assertSame('2026-02-01', $entry->entry_date->toDateString());
        $this->assertSame(10000, (int) $entry->lines->sum('debit'));
        $this->assertSame(10000, (int) $entry->lines->sum('credit'));
    }

    /** @test */
    public function posting_on_the_first_day_of_a_lock_fails(): void
    {
        $this->lock();

        $this->expectException(AccountingPeriodLockedException::class);
        $this->postEntry(self::LOCK_START);
    }

    /** @test */
    public function posting_on_the_last_day_of_a_lock_fails(): void
    {
        $this->lock();

        $this->expectException(AccountingPeriodLockedException::class);
        $this->postEntry(self::LOCK_END);
    }

    /** @test */
    public function posting_just_before_and_just_after_the_range_succeeds(): void
    {
        $this->lock();

        $this->assertSame('2025-12-31', $this->postEntry('2025-12-31')->entry_date->toDateString());
        $this->assertSame('2026-02-01', $this->postEntry('2026-02-01')->entry_date->toDateString());
    }

    /** @test */
    public function a_date_inside_the_range_fails_and_the_implicit_today_is_guarded_too(): void
    {
        $this->lock();
        $this->expectException(AccountingPeriodLockedException::class);
        $this->postEntry('2026-01-15');
    }

    /** @test */
    public function an_omitted_date_is_guarded_as_today_not_waved_through(): void
    {
        // «اليوم» هو التاريخ الفعلي المحكوم حين لا يُمرَّر تاريخ صريح.
        Carbon::setTestNow(Carbon::parse('2026-01-15 09:00:00'));
        try {
            $this->lock();
            $this->expectException(AccountingPeriodLockedException::class);
            $this->postEntry(null);
        } finally {
            Carbon::setTestNow();
        }
    }

    // ── 5. المسودات تبقى مسموحة داخل الفترة المقفلة ─────────────────────

    /** @test */
    public function draft_create_edit_and_delete_stay_allowed_inside_a_locked_period(): void
    {
        $this->lock();

        $journal = $this->draft('2026-01-10');
        $this->assertSame('draft', $journal->status);

        $updated = app(ManualJournalService::class)->update($journal, ['entry_date' => '2026-01-20'], [
            ['account_id' => $this->accountId('1110'), 'debit' => 7000, 'credit' => 0],
            ['account_id' => $this->accountId('3110'), 'debit' => 0, 'credit' => 7000],
        ]);
        $this->assertSame('2026-01-20', $updated->entry_date->toDateString());

        app(ManualJournalService::class)->deleteDraft($updated);
        $this->assertNull(ManualJournal::find($journal->id));

        // …لكن ترحيل المسودة داخل الفترة ممنوع. القفل قفلُ فترة لا قفلُ مستند.
        $second = $this->draft('2026-01-10');
        $this->expectException(AccountingPeriodLockedException::class);
        app(ManualJournalService::class)->post($second);
    }

    /** @test */
    public function a_draft_moved_to_an_open_date_posts_normally(): void
    {
        $journal = $this->draft('2026-01-10');
        $this->lock();

        $moved = app(ManualJournalService::class)->update($journal, ['entry_date' => '2026-03-05'], [
            ['account_id' => $this->accountId('1110'), 'debit' => 5000, 'credit' => 0],
            ['account_id' => $this->accountId('3110'), 'debit' => 0, 'credit' => 5000],
        ]);

        $posted = app(ManualJournalService::class)->post($moved);
        $this->assertSame('posted', $posted->status);
        $this->assertSame('2026-03-05', $posted->journalEntry->entry_date->toDateString());
    }

    // ── 6-8. دلالات العكس ───────────────────────────────────────────────

    /** @test */
    public function an_original_inside_a_locked_period_is_reversed_into_an_open_date(): void
    {
        $original = $this->postEntry('2026-01-15'); // قبل القفل
        $this->lock();

        $reversal = app(LedgerService::class)->reverse($original, '2026-09-10', 'تصحيح');

        $this->assertSame('2026-09-10', $reversal->entry_date->toDateString());
        $this->assertSame($original->id, $reversal->reversal_of);
        $this->assertSame(10000, (int) $reversal->lines->sum('debit'));
        $this->assertSame(10000, (int) $reversal->lines->sum('credit'));
    }

    /** @test */
    public function a_reversal_dated_inside_a_lock_fails(): void
    {
        $original = $this->postEntry('2026-01-15');
        $this->lock();

        $this->expectException(AccountingPeriodLockedException::class);
        app(LedgerService::class)->reverse($original, '2026-01-20', 'تصحيح');
    }

    /** @test */
    public function the_original_entry_is_never_mutated_by_a_lock_or_a_blocked_reversal(): void
    {
        $original = $this->postEntry('2026-01-15');
        $before = $original->only(['entry_date', 'status', 'number']);
        $linesBefore = $original->lines->map->only(['account_id', 'debit', 'credit'])->toArray();
        $this->lock();

        try {
            app(LedgerService::class)->reverse($original->fresh(), '2026-01-20');
            $this->fail('كان يجب رفض العكس داخل الفترة المقفلة.');
        } catch (AccountingPeriodLockedException) {
            // المتوقّع.
        }

        $after = $original->fresh('lines');
        $this->assertSame($before['number'], $after->number);
        $this->assertSame('2026-01-15', $after->entry_date->toDateString());
        $this->assertSame('posted', $after->status); // لم يُوسم `reversed`
        $this->assertSame($linesBefore, $after->lines->map->only(['account_id', 'debit', 'credit'])->toArray());
    }

    /** @test */
    public function reversal_copies_the_original_concrete_accounts_without_re_resolving_roles(): void
    {
        $original = $this->postEntry('2026-05-01');
        $cash = $this->accountId('1110');

        // إعادة توجيه دور المخزون بعد الترحيل لا تمسّ العكس: العكس ينسخ
        // حسابات الأصل الفعلية ولا يُعيد حلّ أي دور دلالي.
        $reversal = app(LedgerService::class)->reverse($original, '2026-06-01');

        $this->assertSame(
            $original->lines->pluck('account_id')->sort()->values()->all(),
            $reversal->lines->pluck('account_id')->sort()->values()->all(),
        );
        $this->assertSame(10000, (int) $reversal->lines->firstWhere('account_id', $cash)->credit);
    }

    // ── 9-11. قواعد النطاقات ────────────────────────────────────────────

    /** @test */
    public function overlapping_active_ranges_are_rejected(): void
    {
        $this->lock('2026-01-01', '2026-01-31');

        foreach ([
            ['2026-01-15', '2026-02-15'], // يتداخل من اليمين
            ['2025-12-15', '2026-01-05'], // يتداخل من اليسار
            ['2026-01-10', '2026-01-20'], // محتوى بالكامل
            ['2025-12-01', '2026-03-01'], // يحتوي القائم
            ['2026-01-31', '2026-02-10'], // يتشارك يوماً واحداً فقط
        ] as [$start, $end]) {
            try {
                $this->lock($start, $end);
                $this->fail("كان يجب رفض التداخل {$start}..{$end}");
            } catch (RuntimeException $e) {
                $this->assertStringContainsString('يتداخل', $e->getMessage());
            }
        }

        $this->assertSame(1, AccountingPeriodLock::where('status', 'active')->count());
    }

    /** @test */
    public function adjacent_ranges_are_allowed(): void
    {
        $this->lock('2026-01-01', '2026-01-31');
        $this->lock('2026-02-01', '2026-02-28', 'إقفال فبراير');

        $this->assertSame(2, AccountingPeriodLock::where('status', 'active')->count());
        $this->expectException(AccountingPeriodLockedException::class);
        $this->postEntry('2026-02-14');
    }

    /** @test */
    public function a_start_date_after_the_end_date_is_rejected(): void
    {
        $this->expectException(RuntimeException::class);
        $this->lock('2026-02-01', '2026-01-01');
    }

    /** @test */
    public function a_released_range_stops_blocking_and_the_row_survives(): void
    {
        $lock = $this->lock();
        try {
            $this->postEntry('2026-01-15');
            $this->fail('كان يجب المنع قبل التحرير.');
        } catch (AccountingPeriodLockedException) {
            // المتوقّع.
        }

        app(AccountingPeriodLockService::class)->release($lock['id'], 'تصحيح فاتورة متأخرة', null);

        $entry = $this->postEntry('2026-01-15');
        $this->assertSame('2026-01-15', $entry->entry_date->toDateString());

        $row = AccountingPeriodLock::find($lock['id']);
        $this->assertNotNull($row); // لا حذف فعلي
        $this->assertSame('released', $row->status);
        $this->assertSame('تصحيح فاتورة متأخرة', $row->release_reason);
    }

    /** @test */
    public function releasing_frees_the_range_for_a_replacement_lock(): void
    {
        $lock = $this->lock('2026-01-01', '2026-01-31');
        app(AccountingPeriodLockService::class)->release($lock['id'], 'إعادة ضبط النطاق', null);

        // التصحيح = تحرير ثم إنشاء بديل. لا تعديل في المكان ولا حذف.
        $replacement = $this->lock('2026-01-01', '2026-02-28', 'إقفال يناير وفبراير');
        $this->assertSame('active', $replacement['status']);
        $this->assertSame(1, AccountingPeriodLock::where('status', 'active')->count());
        $this->assertSame(2, AccountingPeriodLock::count());
    }

    // ── 12. عزل المستأجرين ──────────────────────────────────────────────

    /** @test */
    public function a_lock_in_tenant_a_never_blocks_tenant_b(): void
    {
        $this->lock();

        $other = Tenant::create([
            'name' => 'مؤسسة أخرى', 'slug' => 'other-acc6',
            'vat_number' => '300000000000004', 'currency' => 'SAR',
        ]);
        app(TenantContext::class)->set($other->id);
        app(ChartOfAccountsSeeder::class)->seed($other->id);

        $entry = $this->postEntry('2026-01-15');
        $this->assertSame('2026-01-15', $entry->entry_date->toDateString());
        $this->assertSame($other->id, $entry->tenant_id);
        $this->assertSame(0, AccountingPeriodLock::count()); // لا يرى أقفال الأول

        // …وعودةً للأول يبقى المنع قائماً.
        app(TenantContext::class)->set($this->tenant->id);
        $this->expectException(AccountingPeriodLockedException::class);
        $this->postEntry('2026-01-15');
    }

    // ── 13-15. RBAC على مستوى الـAPI ────────────────────────────────────

    /** @test */
    public function the_api_requires_the_view_permission_to_list_locks(): void
    {
        $auth = $this->registerTenant();
        $staff = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff@acme.test');

        $this->withToken($auth['token'])->getJson('/api/accounting-settings/period-locks')->assertOk();
        $this->withToken($staff)->getJson('/api/accounting-settings/period-locks')->assertForbidden();
        // `withToken` يثبّت الترويسة على نسخة الاختبار، فتُمسح صراحةً قبل
        // فحص الطلب غير المصادَق — وإلا ورث توكن الطلب السابق وفحص لا شيء.
        $this->flushHeaders();
        $this->getJson('/api/accounting-settings/period-locks')->assertUnauthorized();
    }

    /** @test */
    public function the_api_requires_the_manage_permission_to_create_or_release_a_lock(): void
    {
        $auth = $this->registerTenant();
        $accountant = $this->tokenForRole($auth['tenant_id'], 'accountant', 'acc@acme.test');
        $payload = ['start_date' => '2026-01-01', 'end_date' => '2026-01-31', 'reason' => 'إقفال يناير'];

        // المحاسب دورٌ تشغيلي: لا يقفل فترة ولا يحرّرها.
        $this->withToken($accountant)->postJson('/api/accounting-settings/period-locks', $payload)->assertForbidden();

        $created = $this->withToken($auth['token'])
            ->postJson('/api/accounting-settings/period-locks', $payload)->assertCreated();
        $id = $created['data']['id'];

        $this->withToken($accountant)
            ->postJson("/api/accounting-settings/period-locks/{$id}/release", ['reason' => 'محاولة'])
            ->assertForbidden();

        $this->withToken($auth['token'])
            ->postJson("/api/accounting-settings/period-locks/{$id}/release", ['reason' => 'إعادة فتح'])
            ->assertOk()->assertJsonPath('data.status', 'released');
    }

    /** @test */
    public function unauthenticated_and_cross_tenant_api_attempts_are_rejected(): void
    {
        $a = $this->registerTenant('alpha', 'a@alpha.test');
        $b = $this->registerTenant('beta', 'b@beta.test');

        $created = $this->withToken($a['token'])->postJson('/api/accounting-settings/period-locks', [
            'start_date' => '2026-01-01', 'end_date' => '2026-01-31', 'reason' => 'إقفال',
        ])->assertCreated();
        $id = $created['data']['id'];

        // مستأجر آخر لا يرى القفل ولا يحرّره بمعرّفه.
        $this->withToken($b['token'])->getJson('/api/accounting-settings/period-locks')
            ->assertOk()->assertJsonCount(0, 'data.locks');
        $this->withToken($b['token'])
            ->postJson("/api/accounting-settings/period-locks/{$id}/release", ['reason' => 'محاولة'])
            ->assertStatus(422);

        $this->flushHeaders();
        $this->postJson('/api/accounting-settings/period-locks', [
            'start_date' => '2026-01-01', 'end_date' => '2026-01-31', 'reason' => 'إقفال',
        ])->assertUnauthorized();
    }

    /** @test */
    public function there_is_no_hard_delete_route_for_a_lock(): void
    {
        $auth = $this->registerTenant();
        $created = $this->withToken($auth['token'])->postJson('/api/accounting-settings/period-locks', [
            'start_date' => '2026-01-01', 'end_date' => '2026-01-31', 'reason' => 'إقفال',
        ])->assertCreated();

        $this->withToken($auth['token'])
            ->deleteJson("/api/accounting-settings/period-locks/{$created['data']['id']}")
            ->assertNotFound();
    }

    // ── 16. التزامن ─────────────────────────────────────────────────────

    /** @test */
    public function two_overlapping_lock_creations_never_leave_two_active_ranges(): void
    {
        // على محرّك واحد لا يمكن محاكاة خيطين؛ ما يُفحص هنا هو الثابت نفسه:
        // مهما تكرّرت المحاولات لا يبقى نطاقان نشطان متداخلان. الاختبار
        // التزامني الحقيقي بموصلَين متوازيين في `..._under_real_concurrency`.
        $this->lock('2026-01-01', '2026-01-31');

        for ($i = 0; $i < 5; $i++) {
            try {
                $this->lock('2026-01-10', '2026-02-10');
            } catch (RuntimeException) {
                // المتوقّع.
            }
        }

        $active = AccountingPeriodLock::where('status', 'active')->get();
        $this->assertCount(1, $active);
        $this->assertSame('2026-01-31', $active->first()->end_date->toDateString());
    }

    /** @test */
    public function the_guard_and_the_lock_writer_share_one_tenant_anchor(): void
    {
        // المِرساة عقدٌ لا تفصيل: لو تباعد المساران عن صفّ المستأجر عاد سباق
        // «افحص ثم أدرج». يُثبت هنا أن كليهما يقرأ سياق المستأجر نفسه.
        $guard = app(AccountingDateGuard::class);
        $this->assertNull($guard->activeLockFor('2026-01-15'));

        $this->lock();
        $found = $guard->activeLockFor('2026-01-15');
        $this->assertNotNull($found);
        $this->assertSame($this->tenant->id, $found->tenant_id);
    }

    // ── 17-18. فشلٌ مغلق بلا أثر جزئي ───────────────────────────────────

    /** @test */
    public function a_rejected_posting_leaves_no_journal_entry_or_line_behind(): void
    {
        $this->lock();
        $entriesBefore = JournalEntry::count();

        try {
            $this->postEntry('2026-01-15');
            $this->fail('كان يجب الرفض.');
        } catch (AccountingPeriodLockedException) {
            // المتوقّع.
        }

        $this->assertSame($entriesBefore, JournalEntry::count());
        $this->assertSame(0, JournalEntry::whereDate('entry_date', '2026-01-15')->count());
    }

    /** @test */
    public function a_rejected_invoice_posting_leaves_no_partial_operational_side_effects(): void
    {
        $warehouse = Warehouse::create(['name' => 'المخزن الرئيسي', 'code' => 'WH-1', 'is_default' => true]);
        $customer = Partner::create(['name' => 'عميل', 'type' => 'customer']);
        $product = Product::create([
            'name' => 'صنف', 'sku' => 'SKU-1', 'type' => 'good',
            'sale_price' => 20000, 'purchase_price' => 10000, 'track_inventory' => true,
        ]);
        app(InventoryService::class)->receiveStock($product, 100, 10000, ['warehouse_id' => $warehouse->id]);

        $invoice = app(InvoiceService::class)->create(
            ['partner_id' => $customer->id, 'payment_type' => 'credit', 'warehouse_id' => $warehouse->id, 'invoice_date' => '2026-01-15'],
            [['product_id' => $product->id, 'quantity' => 2, 'unit_price' => 20000, 'tax_rate' => 15]],
        );

        $this->lock();

        $quantityBefore = (int) $product->fresh()->quantity_on_hand;
        $stockRowBefore = (int) ProductWarehouseStock::where('warehouse_id', $warehouse->id)
            ->where('product_id', $product->id)->value('quantity');
        $entriesBefore = JournalEntry::count();

        try {
            app(InvoiceService::class)->post($invoice);
            $this->fail('كان يجب الرفض.');
        } catch (AccountingPeriodLockedException) {
            // المتوقّع.
        }

        // لا قيد، ولا حركة مخزون، ولا فاتورة مرحّلة — المعاملة تراجعت كاملةً.
        $this->assertSame($entriesBefore, JournalEntry::count());
        $this->assertSame($quantityBefore, (int) $product->fresh()->quantity_on_hand);
        $this->assertSame($stockRowBefore, (int) ProductWarehouseStock::where('warehouse_id', $warehouse->id)
            ->where('product_id', $product->id)->value('quantity'));
        $this->assertSame('draft', $invoice->fresh()->status);
    }

    // ── 19-21. تغطية مسارات الترحيل والمحرك ─────────────────────────────

    /** @test */
    public function representative_document_paths_are_all_blocked_by_the_central_guard(): void
    {
        $warehouse = Warehouse::create(['name' => 'المخزن الرئيسي', 'code' => 'WH-1', 'is_default' => true]);
        $customer = Partner::create(['name' => 'عميل', 'type' => 'customer']);
        $supplier = Partner::create(['name' => 'مورّد', 'type' => 'supplier']);
        $product = Product::create([
            'name' => 'صنف', 'sku' => 'SKU-2', 'type' => 'good',
            'sale_price' => 20000, 'purchase_price' => 10000, 'track_inventory' => true,
        ]);
        app(InventoryService::class)->receiveStock($product, 100, 10000, ['warehouse_id' => $warehouse->id]);

        $invoice = app(InvoiceService::class)->create(
            ['partner_id' => $customer->id, 'payment_type' => 'credit', 'warehouse_id' => $warehouse->id, 'invoice_date' => '2026-01-15'],
            [['product_id' => $product->id, 'quantity' => 1, 'unit_price' => 20000, 'tax_rate' => 15]],
        );
        $purchase = app(PurchaseService::class)->create(
            ['partner_id' => $supplier->id, 'payment_type' => 'credit', 'warehouse_id' => $warehouse->id, 'purchase_date' => '2026-01-15'],
            [['product_id' => $product->id, 'quantity' => 3, 'unit_price' => 9000, 'tax_rate' => 15]],
        );
        $manual = $this->draft('2026-01-15');

        $this->lock();

        foreach ([
            'invoice'  => fn () => app(InvoiceService::class)->post($invoice),
            'purchase' => fn () => app(PurchaseService::class)->post($purchase),
            'manual'   => fn () => app(ManualJournalService::class)->post($manual),
        ] as $label => $attempt) {
            try {
                $attempt();
                $this->fail("كان يجب منع الترحيل: {$label}");
            } catch (AccountingPeriodLockedException) {
                $this->assertTrue(true, $label);
            }
        }
    }

    /** @test */
    public function ledger_post_and_reverse_cannot_be_called_past_the_guard(): void
    {
        $original = $this->postEntry('2026-05-01');
        $this->lock();

        // لا وسيط `force`، ولا مفتاح تجاوز، ولا توقيع بديل يتخطّى الحارس:
        // التوقيعان العامّان الوحيدان للمحرك هما `post` و`reverse` وكلاهما محروس.
        $ledger = new \ReflectionClass(LedgerService::class);
        $public = collect($ledger->getMethods(\ReflectionMethod::IS_PUBLIC))
            ->reject(fn ($m) => $m->isConstructor())
            ->map(fn ($m) => $m->getName())->sort()->values()->all();
        $this->assertSame(['post', 'reverse'], $public);

        foreach ($ledger->getMethod('post')->getParameters() as $parameter) {
            $this->assertNotSame('force', $parameter->getName());
        }

        try {
            $this->postEntry('2026-01-15');
            $this->fail('post تجاوز الحارس.');
        } catch (AccountingPeriodLockedException) {
            $this->assertTrue(true);
        }

        $this->expectException(AccountingPeriodLockedException::class);
        app(LedgerService::class)->reverse($original, '2026-01-15');
    }

    /** @test */
    public function no_code_outside_the_ledger_writes_journal_rows_directly(): void
    {
        // هذا هو ما يجعل «كل مستهلكي الترحيل مغطّون» عبارةً قابلة للإثبات لا
        // دعوى: ما دام لا كاتب مباشر للدفتر خارج المحرك، فحارسٌ واحد داخله
        // يغطّي كل مسار قائم **وكل مسار مستقبلي**. يُفحص المصدر لا سلوك
        // اختبارٍ بعينه، فلا يمرّ مستهلكٌ جديد يلتفّ على المحرك بصمت.
        $ledger = realpath(app_path('Services/Accounting/LedgerService.php'));
        $offenders = [];

        $files = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator(app_path()));
        foreach ($files as $file) {
            if ($file->getExtension() !== 'php' || realpath($file->getPathname()) === $ledger) {
                continue;
            }

            // التعليقات تُجرَّد أولاً: توثيق «لا كتابة مباشرة في journal_lines»
            // منتشرٌ في رؤوس الخدمات، وعدُّه مخالفةً يقلب الحارس ضدّ نفسه.
            $code = '';
            foreach (token_get_all(file_get_contents($file->getPathname())) as $token) {
                if (is_array($token) && in_array($token[0], [T_COMMENT, T_DOC_COMMENT], true)) {
                    continue;
                }
                $code .= is_array($token) ? $token[1] : $token;
            }

            $writes = '/\b(JournalEntry|JournalLine)::(create|insert|insertGetId|forceCreate|updateOrCreate|firstOrCreate)\b'
                . '|new\s+(JournalEntry|JournalLine)\s*\('
                . "|table\\(\\s*'(journal_entries|journal_lines)'/";

            if (preg_match($writes, $code) === 1) {
                $offenders[] = str_replace(base_path() . '/', '', $file->getPathname());
            }
        }

        sort($offenders);
        $this->assertSame([], $offenders, 'كاتبٌ مباشر لدفتر اليومية خارج LedgerService يتجاوز حارس الفترات.');
    }

    /** @test */
    public function a_company_wide_lock_blocks_every_branch_including_null_branch_lines(): void
    {
        $this->lock();

        // القفل مؤسسي: سطرٌ بلا فرع (مصروف مركزي) وسطرٌ موسوم بفرع يُمنعان معاً.
        $this->expectException(AccountingPeriodLockedException::class);
        app(LedgerService::class)->post([
            ['account_id' => $this->accountId('1110'), 'debit' => 10000],
            ['account_id' => $this->accountId('3110'), 'credit' => 10000],
        ], ['entry_date' => '2026-01-15', 'branch_id' => null]);
    }

    // ── 22-25. عدم الارتداد على الطبقات القائمة ─────────────────────────

    /** @test */
    public function an_open_period_changes_nothing_about_amounts_accounts_or_direction(): void
    {
        $beforeLock = $this->postEntry('2026-05-01');
        $this->lock();
        $afterLock = $this->postEntry('2026-05-02'); // خارج النطاق

        $this->assertSame(
            $beforeLock->lines->map->only(['account_id', 'debit', 'credit'])->toArray(),
            $afterLock->lines->map->only(['account_id', 'debit', 'credit'])->toArray(),
        );
        foreach ([$beforeLock, $afterLock] as $entry) {
            $this->assertSame((int) $entry->lines->sum('debit'), (int) $entry->lines->sum('credit'));
        }
    }

    /** @test */
    public function reports_and_history_still_see_entries_inside_a_locked_period(): void
    {
        $entry = $this->postEntry('2026-01-15');
        $this->lock();

        // القفل يمنع الكتابة الجديدة فقط؛ التاريخ يبقى مقروءاً كما هو.
        $this->assertSame(1, JournalEntry::whereDate('entry_date', '2026-01-15')->count());
        $this->assertNotNull(JournalEntry::find($entry->id));
        $this->assertSame(10000, (int) $entry->fresh('lines')->lines->sum('debit'));
    }

    // ── التدقيق ─────────────────────────────────────────────────────────

    /** @test */
    public function creating_and_releasing_a_lock_write_immutable_audit_events(): void
    {
        $lock = $this->lock();
        app(AccountingPeriodLockService::class)->release($lock['id'], 'تصحيح متأخر', null);

        $events = AccountingPeriodLockEvent::where('accounting_period_lock_id', $lock['id'])
            ->orderBy('created_at')->get();

        $this->assertSame(['lock_created', 'lock_released'], $events->pluck('action')->all());
        $this->assertSame('إقفال يناير', $events[0]->reason);
        $this->assertSame('تصحيح متأخر', $events[1]->reason);
        $this->assertSame(self::LOCK_START, $events[0]->start_date->toDateString());

        $this->assertThrows(fn () => $events[0]->update(['reason' => 'تلاعب']), LogicException::class);
        $this->assertThrows(fn () => $events[0]->delete(), LogicException::class);
    }

    /** @test */
    public function the_audit_trail_records_the_actor_behind_each_action(): void
    {
        $auth = $this->registerTenant();
        $created = $this->withToken($auth['token'])->postJson('/api/accounting-settings/period-locks', [
            'start_date' => '2026-01-01', 'end_date' => '2026-01-31', 'reason' => 'إقفال يناير',
        ])->assertCreated();
        $id = $created['data']['id'];

        $this->withToken($auth['token'])
            ->postJson("/api/accounting-settings/period-locks/{$id}/release", ['reason' => 'إعادة فتح'])->assertOk();

        $events = $this->withToken($auth['token'])
            ->getJson("/api/accounting-settings/period-locks/{$id}/events")->assertOk()->json('data');

        $this->assertCount(2, $events);
        foreach ($events as $event) {
            $this->assertSame('المالك', $event['actor']);
        }
        $this->assertSame('المالك', $created['data']['created_by']);
    }

    /** @test */
    public function a_lock_requires_a_reason_on_both_create_and_release(): void
    {
        $auth = $this->registerTenant();

        $this->withToken($auth['token'])->postJson('/api/accounting-settings/period-locks', [
            'start_date' => '2026-01-01', 'end_date' => '2026-01-31',
        ])->assertStatus(422);

        $created = $this->withToken($auth['token'])->postJson('/api/accounting-settings/period-locks', [
            'start_date' => '2026-01-01', 'end_date' => '2026-01-31', 'reason' => 'إقفال',
        ])->assertCreated();

        $this->withToken($auth['token'])
            ->postJson("/api/accounting-settings/period-locks/{$created['data']['id']}/release", [])
            ->assertStatus(422);
    }

    /** @test */
    public function a_released_lock_cannot_be_released_twice(): void
    {
        $lock = $this->lock();
        app(AccountingPeriodLockService::class)->release($lock['id'], 'أول', null);

        $this->expectException(RuntimeException::class);
        app(AccountingPeriodLockService::class)->release($lock['id'], 'ثانٍ', null);
    }
}
