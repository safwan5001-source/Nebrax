<?php

namespace Tests\Feature;

use App\Models\CreditNote;
use App\Models\CreditNoteLine;
use App\Models\Invoice;
use App\Models\Partner;
use App\Models\Product;
use App\Models\Tenant;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\CreditNoteService;
use App\Services\Accounting\InvoiceService;
use App\Support\Settings;
use App\Tenancy\TenantContext;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use RuntimeException;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  AWJ-TAX-REM-02 — سياسة الهجرة للإشعار الدائن (ADR-E · ACC-06)
 * ═══════════════════════════════════════════════════════════════
 *  - المستأجرون القائمون يُثبَّتون على `allow_standalone_credit_notes = true`
 *    (لا تتعطل مسوداتهم)، والجدد يأخذون الافتراض `false`.
 *  - هجرة الأعمدة إضافية وقابلة للتراجع دون فقد بيانات الأسطر القائمة.
 *  - هجرة تقييد الحذف تتحقق من المراجع التاريخية قبل أن تقيّد، ولا تعدّلها.
 *
 *  تشغيل:  php artisan test --filter=CreditNoteMigrationPolicyTest
 */
class CreditNoteMigrationPolicyTest extends TestCase
{
    use RefreshDatabase;

    private const POLICY = '2026_11_04_030000_pin_standalone_credit_notes_for_existing_tenants.php';
    private const COLUMNS = '2026_11_04_010000_add_source_line_to_credit_note_lines.php';
    private const FK = '2026_11_04_020000_restrict_credit_note_original_invoice_delete.php';

    private function migration(string $file): Migration
    {
        return require base_path('database/migrations/' . $file);
    }

    private function tenantWith(string $slug, ?array $settings): Tenant
    {
        $tenant = Tenant::create([
            'name' => $slug, 'slug' => $slug, 'vat_number' => '300000000000003', 'currency' => 'SAR',
        ]);
        DB::table('tenants')->where('id', $tenant->id)->update([
            'settings' => $settings === null ? null : json_encode($settings, JSON_UNESCAPED_UNICODE),
        ]);

        return $tenant->fresh();
    }

    private function stored(Tenant $tenant): array
    {
        return json_decode((string) DB::table('tenants')->where('id', $tenant->id)->value('settings'), true) ?: [];
    }

    // ── سياسة المستأجرين القائمين / الجدد ───────────────────────────

    /** @test */
    public function existing_tenants_are_pinned_to_standalone_allowed_and_explicit_choices_are_kept(): void
    {
        $none      = $this->tenantWith('policy-none', null);
        $noSales   = $this->tenantWith('policy-no-sales', ['company' => ['city' => 'الدمام']]);
        $noKey     = $this->tenantWith('policy-no-key', ['sales' => ['default_tax_rate' => 5]]);
        $explicitF = $this->tenantWith('policy-explicit-false', ['sales' => ['allow_standalone_credit_notes' => false]]);
        $explicitT = $this->tenantWith('policy-explicit-true', ['sales' => ['allow_standalone_credit_notes' => true]]);

        $this->migration(self::POLICY)->up();

        $this->assertTrue($this->stored($none)['sales']['allow_standalone_credit_notes']);
        $this->assertTrue($this->stored($noSales)['sales']['allow_standalone_credit_notes']);
        $this->assertSame('الدمام', $this->stored($noSales)['company']['city'], 'مجموعات الإعدادات الأخرى لا تُمسّ.');
        $this->assertTrue($this->stored($noKey)['sales']['allow_standalone_credit_notes']);
        $this->assertSame(5, $this->stored($noKey)['sales']['default_tax_rate'], 'المفاتيح الأخرى في المجموعة لا تُمسّ.');
        $this->assertFalse($this->stored($explicitF)['sales']['allow_standalone_credit_notes'], 'قرار صريح سابق لا يُقلب.');
        $this->assertTrue($this->stored($explicitT)['sales']['allow_standalone_credit_notes']);
    }

    /** @test */
    public function the_policy_migration_is_idempotent(): void
    {
        $tenant = $this->tenantWith('policy-idem', null);

        $this->migration(self::POLICY)->up();
        $once = $this->stored($tenant);
        $this->migration(self::POLICY)->up();

        $this->assertSame($once, $this->stored($tenant));
    }

    /** @test */
    public function an_existing_tenant_keeps_issuing_standalone_notes_while_a_new_tenant_must_opt_in(): void
    {
        $existing = $this->tenantWith('policy-existing', ['sales' => ['default_tax_rate' => 15]]);
        $this->migration(self::POLICY)->up();

        // مستأجر ينشأ بعد الهجرة: لا مفتاح مخزَّن ⇒ الافتراض.
        $fresh = $this->tenantWith('policy-fresh', null);

        $payload = fn (Partner $p) => ['partner_id' => $p->id, 'type' => 'sales', 'note_date' => '2026-01-01'];
        $items = [['quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]];

        app(TenantContext::class)->set($existing->id);
        $customer = Partner::create(['name' => 'عميل', 'type' => 'customer']);
        $this->assertTrue(Settings::get('sales', 'allow_standalone_credit_notes'));
        $note = app(CreditNoteService::class)->create($payload($customer), $items);
        $this->assertSame('sales', $note->type);

        app(TenantContext::class)->set($fresh->id);
        $customer = Partner::create(['name' => 'عميل', 'type' => 'customer']);
        $this->assertFalse(Settings::get('sales', 'allow_standalone_credit_notes'));
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('إعدادات المبيعات تُلزِم ربط الإشعار الدائن بفاتورة مرحَّلة.');
        app(CreditNoteService::class)->create($payload($customer), $items);
    }

    /** @test */
    public function rolling_the_policy_back_removes_only_what_the_migration_pinned(): void
    {
        $pinned    = $this->tenantWith('policy-rollback', ['sales' => ['default_tax_rate' => 5]]);
        $solo      = $this->tenantWith('policy-rollback-solo', null);
        $explicitF = $this->tenantWith('policy-rollback-false', ['sales' => ['allow_standalone_credit_notes' => false]]);
        $explicitT = $this->tenantWith('policy-rollback-true', ['sales' => ['allow_standalone_credit_notes' => true]]);
        $saved     = $this->tenantWith('policy-rollback-saved', null);

        $migration = $this->migration(self::POLICY);
        $migration->up();

        // المستأجر حفظ إعدادات المبيعات بعد الهجرة ⇒ القيمة صارت قراره.
        Settings::put('sales', ['default_tax_rate' => 15], $saved->fresh());

        $migration->down();

        $this->assertSame(['sales' => ['default_tax_rate' => 5]], $this->stored($pinned));
        $this->assertSame([], $this->stored($solo), 'مجموعة sales التي أنشأتها الهجرة وحدها تُزال كاملة.');
        $this->assertFalse($this->stored($explicitF)['sales']['allow_standalone_credit_notes'], 'قرار سابق صريح لا يضيع بالتراجع.');
        $this->assertTrue($this->stored($explicitT)['sales']['allow_standalone_credit_notes']);
        $this->assertTrue($this->stored($saved)['sales']['allow_standalone_credit_notes'], 'قيمة حُفظت من الإعدادات بعد الهجرة لا تُزال.');

        // تراجُع ثم إعادة نشر: قرار `false` الصريح لا ينقلب إلى `true`.
        $migration->up();
        $this->assertFalse($this->stored($explicitF)['sales']['allow_standalone_credit_notes']);
    }

    // ── هجرة الأعمدة: إضافية وقابلة للتراجع ────────────────────────

    /** @test */
    public function the_columns_migration_is_additive_and_rolls_back_without_touching_existing_lines(): void
    {
        $tenant = $this->tenantWith('cols', null);
        app(TenantContext::class)->set($tenant->id);
        $customer = Partner::create(['name' => 'عميل', 'type' => 'customer']);
        $note = CreditNote::create([
            'number' => 'CN-COLS-1', 'type' => 'sales', 'partner_id' => $customer->id, 'refund_type' => 'credit',
            'note_date' => '2026-01-01', 'status' => 'posted', 'subtotal' => 10000, 'tax_amount' => 1500, 'total' => 11500,
        ]);
        $line = CreditNoteLine::create([
            'credit_note_id' => $note->id, 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15,
            'line_subtotal' => 10000, 'line_tax' => 1500, 'line_total' => 11500,
        ]);

        // قبل أي تراجع: الافتراضات إضافية بحتة.
        $this->assertNull($line->fresh()->source_line_id);
        $this->assertSame(0, (int) $line->fresh()->line_discount);

        $migration = $this->migration(self::COLUMNS);
        $migration->down();
        $this->assertFalse(Schema::hasColumn('credit_note_lines', 'source_line_id'));
        $this->assertFalse(Schema::hasColumn('credit_note_lines', 'line_discount'));
        $this->assertSame(
            [10000, 1500, 11500],
            array_map('intval', array_values((array) DB::table('credit_note_lines')->where('id', $line->id)->first(['line_subtotal', 'line_tax', 'line_total']))),
            'التراجع لا يمسّ مبالغ الأسطر القائمة.'
        );

        $migration->up();
        $this->assertTrue(Schema::hasColumn('credit_note_lines', 'source_line_id'));
        $this->assertTrue(Schema::hasColumn('credit_note_lines', 'line_discount'));
        $this->assertNull($line->fresh()->source_line_id);
        $this->assertSame(0, (int) $line->fresh()->line_discount);
        $this->assertSame(11500, (int) $line->fresh()->line_total);
    }

    // ── هجرة تقييد الحذف: تحقق قبل التقييد ────────────────────────

    private function postedInvoice(Tenant $tenant): Invoice
    {
        app(TenantContext::class)->set($tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($tenant->id);
        $customer = Partner::create(['name' => 'عميل ' . $tenant->slug, 'type' => 'customer']);
        $product = Product::create(['name' => 'خدمة', 'track_inventory' => false]);
        $svc = app(InvoiceService::class);

        return $svc->post($svc->create(
            ['partner_id' => $customer->id, 'payment_type' => 'credit'],
            [['product_id' => $product->id, 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]]
        ));
    }

    /** @test */
    public function the_restrict_migration_passes_on_clean_data_and_leaves_historical_mismatches_untouched(): void
    {
        $tenant = $this->tenantWith('fk-clean', null);
        $invoice = $this->postedInvoice($tenant);
        $other = Partner::create(['name' => 'عميل آخر', 'type' => 'customer']);

        // إشعار تاريخي لعميل مختلف عن عميل فاتورته: يُسجَّل في السجل ولا يُعدَّل.
        $historic = CreditNote::create([
            'number' => 'CN-FK-HIST', 'type' => 'sales', 'partner_id' => $other->id, 'refund_type' => 'credit',
            'note_date' => '2026-01-01', 'status' => 'posted', 'original_invoice_id' => $invoice->id,
        ]);

        Log::spy();
        $this->migration(self::FK)->up();

        Log::shouldHaveReceived('warning')->once()->withArgs(
            fn (string $message, array $context) => str_contains($message, 'REM-02')
                && $context['other_customer'] === 1
                && $context['cross_tenant'] === 0
        );
        $this->assertSame($invoice->id, $historic->fresh()->original_invoice_id, 'المرجع التاريخي لم يُعدَّل.');
        $this->assertSame($other->id, $historic->fresh()->partner_id);
    }

    /** @test */
    public function the_restrict_migration_refuses_to_run_over_a_dangling_reference(): void
    {
        if (DB::connection()->getDriverName() !== 'sqlite') {
            $this->markTestSkipped('مرجعٌ معلّق لا يمكن أن ينشأ على PostgreSQL مع مفتاح أجنبي فعّال.');
        }

        $tenant = $this->tenantWith('fk-dangling', null);
        $invoice = $this->postedInvoice($tenant);
        $note = CreditNote::create([
            'number' => 'CN-FK-DANGLING', 'type' => 'sales', 'partner_id' => $invoice->partner_id, 'refund_type' => 'credit',
            'note_date' => '2026-01-01', 'status' => 'posted', 'original_invoice_id' => $invoice->id,
        ]);

        // التأجيل يسمح بإدراج المعلّق داخل معاملة الاختبار (تُتراجع في نهايتها).
        DB::statement('PRAGMA defer_foreign_keys = ON');
        $ghost = (string) \Illuminate\Support\Str::uuid();
        DB::table('credit_notes')->where('id', $note->id)->update(['original_invoice_id' => $ghost]);

        try {
            $this->migration(self::FK)->up();
            $this->fail('الهجرة يجب أن ترفض مرجعاً معلّقاً بدل أن تُخفيه.');
        } catch (RuntimeException $e) {
            $this->assertStringContainsString('يشير إلى فاتورة غير موجودة', $e->getMessage());
        }

        $this->assertSame($ghost, DB::table('credit_notes')->where('id', $note->id)->value('original_invoice_id'), 'لا تعديل صامت.');
    }
}
