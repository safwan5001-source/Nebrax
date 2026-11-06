<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\JournalEntry;
use App\Models\Tenant;
use App\Services\Accounting\LedgerService;
use App\Support\CompanyCurrencyLockedException;
use App\Support\Iso4217;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * CUR-1 — حماية عملة المؤسسة بعد وجود قيود مرحّلة (PUT /api/company).
 *
 * القاعدة: تغيير `tenants.currency` إلى قيمة مختلفة (بعد التطبيع) مرفوض 422 `company_currency_locked` ما دام للمؤسسة
 * قيد `posted` أو `reversed`، بتراجع كامل (لا حفظ جزئي). النفس عملةً (ولو اختلفت الأحرف) ليس تغييراً. رمز غير ISO 4217
 * مرفوض. بلا `currency` يبقى سلوك الحفظ كما كان. لا تحويل عملات ولا مساس ببيانات تاريخية.
 *
 * تشغيل: php artisan test --filter=CompanyCurrencyProtectionTest
 */
class CompanyCurrencyProtectionTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function tenantCurrency(string $tenantId): string
    {
        return (string) DB::table('tenants')->where('id', $tenantId)->value('currency');
    }

    /** يرحّل قيداً متوازناً حقيقياً عبر المحرك (1110 مدين / 3110 دائن) داخل سياق المستأجر. */
    private function postEntry(string $tenantId): JournalEntry
    {
        app(TenantContext::class)->set($tenantId);
        $cash = Account::where('code', '1110')->firstOrFail();
        $capital = Account::where('code', '3110')->firstOrFail();

        return app(LedgerService::class)->post([
            ['account_id' => $cash->id, 'debit' => 10000, 'credit' => 0],
            ['account_id' => $capital->id, 'debit' => 0, 'credit' => 10000],
        ], ['description' => 'CUR-1']);
    }

    /** قيد بحالة محددة مباشرةً (للمسودة/المعكوس فقط؛ الترحيل الحقيقي يمرّ دائماً عبر المحرك). */
    private function rawEntry(string $tenantId, string $status): void
    {
        DB::table('journal_entries')->insert([
            'id' => (string) \Illuminate\Support\Str::uuid(), 'tenant_id' => $tenantId, 'number' => 'JE-CUR1-'.$status,
            'entry_date' => '2026-01-01', 'status' => $status, 'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    private function updateCompany(string $token, array $body)
    {
        return $this->withToken($token)->putJson('/api/company', array_merge(['name' => 'شركة الاختبار'], $body));
    }

    // 1 ─────────────────────────────────────────────────────────────
    /** @test */
    public function currency_can_change_before_any_posted_entry_and_is_normalized_to_uppercase(): void
    {
        ['token' => $token, 'tenant_id' => $id] = $this->registerTenant('cur1-a', 'a@cur1.test');

        $this->updateCompany($token, ['currency' => 'kwd'])->assertOk()->assertJsonPath('company.currency', 'KWD');
        $this->assertSame('KWD', $this->tenantCurrency($id));
    }

    // 2 ─────────────────────────────────────────────────────────────
    /** @test */
    public function change_is_rejected_after_a_posted_entry_with_a_stable_reason(): void
    {
        ['token' => $token, 'tenant_id' => $id] = $this->registerTenant('cur1-b', 'b@cur1.test');
        $this->postEntry($id);

        $this->updateCompany($token, ['currency' => 'USD'])
            ->assertStatus(422)
            ->assertJsonPath('reason', CompanyCurrencyLockedException::REASON)
            ->assertJsonPath('reason', 'company_currency_locked')
            ->assertJsonStructure(['message', 'reason', 'errors' => ['currency']]);

        $this->assertSame('SAR', $this->tenantCurrency($id));
        $this->assertSame(1, JournalEntry::where('tenant_id', $id)->where('status', 'posted')->count(), 'لا مساس بالقيود');
    }

    // 3 ─────────────────────────────────────────────────────────────
    /** @test */
    public function change_is_rejected_after_a_real_reversal(): void
    {
        ['token' => $token, 'tenant_id' => $id] = $this->registerTenant('cur1-c', 'c@cur1.test');
        $entry = $this->postEntry($id);
        app(LedgerService::class)->reverse($entry);

        $this->assertSame('reversed', JournalEntry::findOrFail($entry->id)->status);
        $this->updateCompany($token, ['currency' => 'EUR'])->assertStatus(422)->assertJsonPath('reason', 'company_currency_locked');
        $this->assertSame('SAR', $this->tenantCurrency($id));
    }

    /** @test */
    public function a_reversed_only_ledger_also_locks_the_currency(): void
    {
        ['token' => $token, 'tenant_id' => $id] = $this->registerTenant('cur1-c2', 'c2@cur1.test');
        $this->rawEntry($id, 'reversed');

        $this->updateCompany($token, ['currency' => 'EUR'])->assertStatus(422)->assertJsonPath('reason', 'company_currency_locked');
        $this->assertSame('SAR', $this->tenantCurrency($id));
    }

    // 4 ─────────────────────────────────────────────────────────────
    /** @test */
    public function draft_entries_alone_do_not_lock_the_currency(): void
    {
        ['token' => $token, 'tenant_id' => $id] = $this->registerTenant('cur1-d', 'd@cur1.test');
        $this->rawEntry($id, 'draft');

        $this->updateCompany($token, ['currency' => 'AED'])->assertOk()->assertJsonPath('company.currency', 'AED');
        $this->assertSame('AED', $this->tenantCurrency($id));
    }

    // 5 ─────────────────────────────────────────────────────────────
    /** @test */
    public function the_same_currency_in_any_case_is_not_a_change_even_after_posting(): void
    {
        ['token' => $token, 'tenant_id' => $id] = $this->registerTenant('cur1-e', 'e@cur1.test');
        $this->postEntry($id);

        foreach (['SAR', 'sar', 'Sar', ' sar '] as $same) {
            $this->updateCompany($token, ['currency' => $same, 'city' => 'الخبر'])->assertOk()->assertJsonPath('company.currency', 'SAR');
        }
        $this->assertSame('SAR', $this->tenantCurrency($id));
        $this->assertSame('الخبر', Tenant::find($id)->settings['company']['city']);
    }

    /** @test */
    public function a_legacy_unnormalized_stored_code_is_never_rewritten_when_the_request_does_not_change_it(): void
    {
        ['token' => $token, 'tenant_id' => $id] = $this->registerTenant('cur1-e2', 'e2@cur1.test');
        $this->postEntry($id);
        DB::table('tenants')->where('id', $id)->update(['currency' => 'sar']); // قيمة تاريخية صغيرة الأحرف

        $this->updateCompany($token, ['currency' => 'SAR', 'city' => 'الدمام'])->assertOk();
        $this->assertSame('sar', $this->tenantCurrency($id), 'لا إعادة كتابة تلقائية لرمز تاريخي');

        $this->updateCompany($token, ['currency' => 'USD'])->assertStatus(422)->assertJsonPath('reason', 'company_currency_locked');
        $this->assertSame('sar', $this->tenantCurrency($id));
    }

    /** @test */
    public function a_legacy_non_iso_stored_code_can_be_resubmitted_unchanged_but_not_adopted_by_others(): void
    {
        ['token' => $token, 'tenant_id' => $id] = $this->registerTenant('cur1-e3', 'e3@cur1.test');
        DB::table('tenants')->where('id', $id)->update(['currency' => 'XYZ']); // رمز تاريخي غير ISO

        // إعادة إرسال المخزَّن نفسه لا ترفض بقية الحفظ، ولا تكتبه.
        $this->updateCompany($token, ['currency' => 'xyz', 'city' => 'جدة'])->assertOk();
        $this->assertSame('XYZ', $this->tenantCurrency($id));
        $this->assertSame('جدة', Tenant::find($id)->settings['company']['city']);

        // وتصحيحه إلى ISO مسموح قبل أي ترحيل (هنا لا قيود).
        $this->updateCompany($token, ['currency' => 'SAR'])->assertOk()->assertJsonPath('company.currency', 'SAR');
    }

    // 6 ─────────────────────────────────────────────────────────────
    /** @test */
    public function non_iso_codes_are_rejected_with_a_validation_error_and_nothing_is_saved(): void
    {
        ['token' => $token, 'tenant_id' => $id] = $this->registerTenant('cur1-f', 'f@cur1.test');

        foreach (['XYZ', 'ABC', 'XXX', 'XAU', 'XTS', 'CLF', 'BOV', '12A', 'SA', 'SARR', 'S R', 'ريا'] as $bad) {
            $this->updateCompany($token, ['currency' => $bad, 'city' => 'لن يُحفظ'])
                ->assertStatus(422)->assertJsonValidationErrors(['currency']);
        }
        $this->assertSame('SAR', $this->tenantCurrency($id));
        $this->assertArrayNotHasKey('city', Tenant::find($id)->settings['company'] ?? []);

        // وصالحة متنوعة الأسّ ومنها اتحادات نقدية تبدأ بـX تُقبل (قبل أي ترحيل).
        foreach (['JPY', 'bhd', 'XOF', 'EUR'] as $good) {
            $this->updateCompany($token, ['currency' => $good])->assertOk();
            $this->assertSame(strtoupper($good), $this->tenantCurrency($id));
        }
    }

    // 7 ─────────────────────────────────────────────────────────────
    /** @test */
    public function other_company_settings_save_normally_without_currency_even_after_posting(): void
    {
        ['token' => $token, 'tenant_id' => $id] = $this->registerTenant('cur1-g', 'g@cur1.test');
        $this->postEntry($id);

        $this->updateCompany($token, ['vat_number' => '310122393500003', 'city' => 'الجبيل', 'phone' => '0123456789'])
            ->assertOk()->assertJsonPath('company.city', 'الجبيل')->assertJsonPath('company.currency', 'SAR');

        $tenant = Tenant::find($id);
        $this->assertSame('310122393500003', $tenant->vat_number);
        $this->assertSame('الجبيل', $tenant->settings['company']['city']);
        $this->assertSame('SAR', $tenant->currency);
    }

    /** @test */
    public function a_null_or_empty_currency_is_ignored_like_an_absent_one(): void
    {
        ['token' => $token, 'tenant_id' => $id] = $this->registerTenant('cur1-g2', 'g2@cur1.test');
        $this->postEntry($id);

        foreach ([null, ''] as $blank) {
            $this->updateCompany($token, ['currency' => $blank, 'city' => 'الخبر'])->assertOk()->assertJsonPath('company.currency', 'SAR');
        }
        $this->assertSame('SAR', $this->tenantCurrency($id));
    }

    // 8 ─────────────────────────────────────────────────────────────
    /** @test */
    public function a_rejected_change_writes_nothing_at_all_no_partial_save(): void
    {
        ['token' => $token, 'tenant_id' => $id] = $this->registerTenant('cur1-h', 'h@cur1.test');
        $this->updateCompany($token, ['name' => 'الاسم الأصلي', 'city' => 'الرياض', 'country' => 'SA'])->assertOk();
        $this->postEntry($id);
        $before = DB::table('tenants')->where('id', $id)->first();

        $this->updateCompany($token, [
            'name' => 'اسم جديد', 'vat_number' => '399999999999993', 'cr_number' => '9999', 'country' => 'AE',
            'city' => 'دبي', 'street' => 'شارع جديد', 'currency' => 'GBP',
        ])->assertStatus(422)->assertJsonPath('reason', 'company_currency_locked');

        $after = DB::table('tenants')->where('id', $id)->first();
        $this->assertEquals($before, $after, 'صف المستأجر لم يتغير إطلاقاً (حقول + settings)');
        $this->assertSame('الاسم الأصلي', $after->name);
    }

    // 9 ─────────────────────────────────────────────────────────────
    /** @test */
    public function a_user_without_company_manage_cannot_change_the_currency_in_any_state(): void
    {
        ['tenant_id' => $id] = $this->registerTenant('cur1-i', 'i@cur1.test');

        foreach (['accountant', 'staff'] as $role) {
            $token = $this->tokenForRole($id, $role, "{$role}@cur1.test");

            // قبل أي ترحيل: 403 (الصلاحية قبل أي فحص عملة).
            $this->updateCompany($token, ['currency' => 'USD'])->assertStatus(403);
            $this->assertSame('SAR', $this->tenantCurrency($id));
        }

        $this->postEntry($id);
        foreach (['accountant', 'staff'] as $role) {
            $token = $this->tokenForRole($id, $role, "{$role}2@cur1.test");
            $this->updateCompany($token, ['currency' => 'USD'])->assertStatus(403);
            $this->updateCompany($token, ['currency' => 'SAR'])->assertStatus(403);
        }
        $this->assertSame('SAR', $this->tenantCurrency($id));
    }

    /** @test */
    public function even_the_owner_cannot_change_the_currency_after_posting(): void
    {
        ['token' => $token, 'tenant_id' => $id] = $this->registerTenant('cur1-i2', 'i2@cur1.test');
        $this->postEntry($id);

        $this->updateCompany($token, ['currency' => 'USD'])->assertStatus(422)->assertJsonPath('reason', 'company_currency_locked');
        $this->assertSame('SAR', $this->tenantCurrency($id));
    }

    // 10 ────────────────────────────────────────────────────────────
    /** @test */
    public function tenant_isolation_one_tenants_entries_neither_lock_nor_get_touched_by_another(): void
    {
        ['token' => $tokenA, 'tenant_id' => $a] = $this->registerTenant('cur1-ja', 'ja@cur1.test');
        ['token' => $tokenB, 'tenant_id' => $b] = $this->registerTenant('cur1-jb', 'jb@cur1.test');
        $this->postEntry($a); // A لها قيد مرحّل؛ B لا

        // A مقفلة.
        $this->updateCompany($tokenA, ['currency' => 'USD'])->assertStatus(422)->assertJsonPath('reason', 'company_currency_locked');
        // B حرّة رغم أن النظام فيه قيود مرحّلة لمستأجر آخر.
        $this->updateCompany($tokenB, ['currency' => 'USD'])->assertOk()->assertJsonPath('company.currency', 'USD');

        $this->assertSame('SAR', $this->tenantCurrency($a));
        $this->assertSame('USD', $this->tenantCurrency($b));

        // وقيد ترحّله B بعد التغيير لا يؤثر على A، ويقفل B وحدها.
        $this->postEntry($b);
        $this->updateCompany($tokenB, ['currency' => 'EUR'])->assertStatus(422);
        $this->assertSame('SAR', $this->tenantCurrency($a));
    }

    // قائمة ISO ───────────────────────────────────────────────────
    /** @test */
    public function the_iso_4217_list_is_well_formed_and_excludes_non_currency_codes(): void
    {
        $codes = Iso4217::CODES;
        $this->assertCount(155, $codes);
        $this->assertSame($codes, array_values(array_unique($codes)));
        $sorted = $codes;
        sort($sorted);
        $this->assertSame($sorted, $codes, 'مرتّبة أبجدياً لتسهيل المراجعة');
        foreach ($codes as $c) {
            $this->assertMatchesRegularExpression('/^[A-Z]{3}$/', $c);
        }

        foreach (['SAR', 'AED', 'KWD', 'BHD', 'OMR', 'JPY', 'USD', 'EUR', 'GBP', 'EGP', 'XOF', 'XAF', 'XPF', 'XCD'] as $ok) {
            $this->assertTrue(Iso4217::isValid($ok), $ok);
        }
        foreach (['XXX', 'XTS', 'XAU', 'XAG', 'XPT', 'XPD', 'XDR', 'XUA', 'XSU', 'XBA', 'XAD', 'CLF', 'BOV', 'CHE', 'CHW', 'COU', 'MXV', 'USN', 'UYI', 'UYW', 'XYZ', '', null] as $bad) {
            $this->assertFalse(Iso4217::isValid($bad), (string) $bad);
        }
        $this->assertSame('KWD', Iso4217::normalize(' kwd '));
    }
}
