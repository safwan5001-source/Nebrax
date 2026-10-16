<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Models\Partner;
use App\Models\Tenant;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\ZatcaInvoiceHasher;
use App\Support\InvoicePartySnapshot;
use App\Support\Settings;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use LogicException;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  REM-14 (14a + 14c) — لقطة البائع والمشتري عند الإصدار (`invoices.party_snapshot`, v1)
 * ═══════════════════════════════════════════════════════════════
 *  المسودة بلا لقطة · الترحيل يلتقط لقطة v1 واحدة · القيم لا تتغيّر بتعديل العميل/المستأجر/ملف المؤسسة ·
 *  الـAPI يعرض المرحَّلة من اللقطة (والمسودة/القديمة من البيانات الحية) · التراجع والإعادة · الثبات وحدود
 *  Eloquent · لا حقن من العميل · نسخ الفاتورة · نقص البيانات لا يمنع الترحيل · لا أثر على XML/QR/الهاش/
 *  القيد/ICV · العزل بين المستأجرين والفروع · وحارس ساكن يمنع أي مسار كتابة التفافي مستقبلاً.
 *
 *  تشغيل: php artisan test --filter=InvoicePartySnapshotTest
 */
class InvoicePartySnapshotTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private array $auth;
    private Tenant $tenant;
    private Partner $customer;

    protected function setUp(): void
    {
        parent::setUp();

        $this->auth = $this->registerTenant('party-snap', 'party-snap@example.test');
        app(TenantContext::class)->set($this->auth['tenant_id']);
        $this->tenant = Tenant::findOrFail($this->auth['tenant_id']);
        $this->tenant->update(['name' => 'شركة الأفق', 'vat_number' => '300000000000003', 'cr_number' => '1010101010', 'country' => 'SA']);
        Settings::put('company', [
            'building_no' => '8228', 'street' => 'شارع الملك فهد', 'additional_no' => '1234', 'district' => 'العليا',
            'city' => 'الرياض', 'postal_code' => '12643', 'short_address' => 'RRRD2929', 'phone' => '0112345678', 'mobile' => '0500000000',
            'logo' => 'data:image/png;base64,AAAA',
        ]);
        $this->customer = Partner::create([
            'name' => 'شركة الأمل', 'name_en' => 'Al Amal Co', 'type' => 'customer', 'entity_type' => 'commercial',
            'vat_number' => '300111222333003', 'cr_number' => '2050000000',
            'street' => 'شارع القدس', 'building_no' => '1234', 'district' => 'الفيحاء', 'city' => 'الدمام',
            'postal_code' => '31411', 'country' => 'SA', 'address' => 'نص حر لا يُلتقط', 'email' => 'secret@example.test', 'phone' => '0551111111',
        ]);
    }

    // ───────────────────────── أدوات ─────────────────────────

    private function draft(?Partner $partner = null, int $price = 100000): Invoice
    {
        return app(InvoiceService::class)->create(
            ['partner_id' => ($partner ?? $this->customer)->id, 'payment_type' => 'credit'],
            [['description' => 'خدمة', 'quantity' => 1, 'unit_price' => $price, 'tax_rate' => 15]],
        );
    }

    private function posted(?Partner $partner = null): Invoice
    {
        return app(InvoiceService::class)->post($this->draft($partner));
    }

    private function raw(string $id): ?string
    {
        return DB::table('invoices')->where('id', $id)->value('party_snapshot');
    }

    private function show(string $id, ?string $token = null, array $headers = [])
    {
        return $this->withToken($token ?? $this->auth['token'])->withHeaders($headers)->getJson("/api/invoices/{$id}");
    }

    /** يغيّر كل البيانات الحيّة التي قد تتسرّب إلى العرض التاريخي. */
    private function mutateLiveMasterData(): void
    {
        $this->tenant->update(['name' => 'اسم جديد للمؤسسة', 'vat_number' => '399999999999993', 'cr_number' => '9999999999', 'country' => 'AE']);
        Settings::put('company', ['street' => 'شارع جديد', 'building_no' => '0001', 'city' => 'جدة', 'postal_code' => '99999', 'phone' => '0100000000']);
        $this->customer->update([
            'name' => 'اسم عميل جديد', 'name_en' => 'New Name', 'vat_number' => null, 'cr_number' => '1', 'street' => 'x', 'building_no' => '9',
            'district' => 'y', 'city' => 'جدة', 'postal_code' => '00000', 'country' => 'AE',
        ]);
    }

    // ───────────────────────── الالتقاط ─────────────────────────

    /** @test */
    public function a_draft_has_no_snapshot_and_posting_captures_one_versioned_snapshot(): void
    {
        $draft = $this->draft();
        $this->assertNull($draft->fresh()->party_snapshot);
        $this->assertNull($this->raw($draft->id));

        $posted = app(InvoiceService::class)->post($draft);
        $snapshot = $posted->fresh()->party_snapshot;

        $this->assertSame(1, $snapshot['v']);
        $this->assertSame(['v', 'seller', 'buyer'], array_keys($snapshot));
        $this->assertSame([
            'tenant_id' => $this->tenant->id, 'branch_id' => $posted->branch_id,
            'name' => 'شركة الأفق', 'vat_number' => '300000000000003', 'cr_number' => '1010101010', 'country' => 'SA',
            'address' => [
                'building_no' => '8228', 'street' => 'شارع الملك فهد', 'additional_no' => '1234', 'district' => 'العليا',
                'city' => 'الرياض', 'postal_code' => '12643', 'short_address' => 'RRRD2929',
            ],
            'phone' => '0112345678', 'mobile' => '0500000000',
        ], $snapshot['seller']);
        $this->assertSame([
            'partner_id' => $this->customer->id, 'entity_type' => 'commercial', 'name' => 'شركة الأمل', 'name_en' => 'Al Amal Co',
            'vat_number' => '300111222333003', 'cr_number' => '2050000000',
            'address' => [
                'building_no' => '1234', 'street' => 'شارع القدس', 'district' => 'الفيحاء', 'city' => 'الدمام',
                'postal_code' => '31411', 'country' => 'SA',
            ],
        ], $snapshot['buyer']);
        $this->assertNotNull(DB::table('invoices')->where('id', $posted->id)->value('issued_at'), 'يُلتقط في الحدّ نفسه مع issued_at');
    }

    /** @test */
    public function the_snapshot_minimises_data_no_logo_contact_free_text_or_credentials(): void
    {
        $json = (string) $this->raw($this->posted()->id);

        foreach (['data:image', 'secret@example.test', '0551111111', 'نص حر لا يُلتقط', 'email', 'logo', 'password', 'token'] as $forbidden) {
            $this->assertStringNotContainsString($forbidden, $json, $forbidden);
        }
    }

    /** @test */
    public function the_captured_values_are_stable_after_live_master_data_changes(): void
    {
        $posted = $this->posted();
        $before = $this->raw($posted->id);

        $this->mutateLiveMasterData();

        $this->assertSame($before, $this->raw($posted->id), 'الصف لم يتغيّر');
        $snapshot = Invoice::findOrFail($posted->id)->party_snapshot;
        $this->assertSame('شركة الأفق', $snapshot['seller']['name']);
        $this->assertSame('300000000000003', $snapshot['seller']['vat_number']);
        $this->assertSame('الرياض', $snapshot['seller']['address']['city']);
        $this->assertSame('شركة الأمل', $snapshot['buyer']['name']);
        $this->assertSame('300111222333003', $snapshot['buyer']['vat_number']);
        $this->assertSame('الدمام', $snapshot['buyer']['address']['city']);
    }

    // ───────────────────────── العرض (API) ─────────────────────────

    /** @test */
    public function a_posted_invoice_is_displayed_from_its_snapshot_not_from_live_data(): void
    {
        $posted = $this->posted();
        $this->mutateLiveMasterData();

        $response = $this->show($posted->id)->assertOk();
        $response->assertJsonPath('data.partner.name', 'شركة الأمل')
            ->assertJsonPath('data.partner.vat_number', '300111222333003')
            ->assertJsonPath('data.partner.city', 'الدمام')
            ->assertJsonPath('data.partner.id', $this->customer->id)
            ->assertJsonPath('data.parties.version', 1)
            ->assertJsonPath('data.parties.seller.name', 'شركة الأفق')
            ->assertJsonPath('data.parties.seller.address.postal_code', '12643')
            ->assertJsonPath('data.parties.buyer.address.building_no', '1234');
        $this->assertArrayNotHasKey('tenant_id', $response['data']['parties']['seller'], 'المعرّف الداخلي لا يُكشف');
        // العميل الحي نفسه تغيّر فعلاً (الإثبات أن العرض لا يقرأه).
        $this->assertSame('اسم عميل جديد', $this->customer->fresh()->name);
    }

    /** @test */
    public function drafts_keep_using_live_party_data_and_expose_no_parties_block(): void
    {
        $draft = $this->draft();
        $this->customer->update(['name' => 'اسم عميل جديد', 'city' => 'جدة']);

        $this->show($draft->id)->assertOk()
            ->assertJsonPath('data.partner.name', 'اسم عميل جديد')
            ->assertJsonPath('data.partner.city', 'جدة')
            ->assertJsonPath('data.parties', null);
    }

    /** @test */
    public function legacy_posted_invoices_with_a_null_snapshot_use_the_documented_live_fallback(): void
    {
        $posted = $this->posted();
        DB::table('invoices')->where('id', $posted->id)->update(['party_snapshot' => null]); // صف مرحَّل قبل REM-14
        $this->customer->update(['name' => 'الاسم الحي الآن']);

        $this->show($posted->id)->assertOk()
            ->assertJsonPath('data.partner.name', 'الاسم الحي الآن')   // توافق مؤقت لا ضمان تاريخي
            ->assertJsonPath('data.parties', null);

        // ولا شيء يملأ اللقطة لاحقاً: تحديث عادي وقراءات.
        Invoice::findOrFail($posted->id)->update(['notes' => 'تحديث']);
        $this->show($posted->id)->assertOk();
        $this->assertNull($this->raw($posted->id));
    }

    /** @test */
    public function an_unknown_snapshot_version_or_shape_is_treated_as_no_snapshot(): void
    {
        $posted = $this->posted();
        DB::table('invoices')->where('id', $posted->id)->update(['party_snapshot' => json_encode(['v' => 2, 'seller' => [], 'buyer' => []])]);
        $this->assertNull(InvoicePartySnapshot::parse(Invoice::findOrFail($posted->id)->party_snapshot));
        $this->assertNull(InvoicePartySnapshot::parse(['v' => 1, 'seller' => ['name' => 'x']]));
        $this->assertNull(InvoicePartySnapshot::parse('not json'));
        $this->show($posted->id)->assertOk()->assertJsonPath('data.parties', null);
    }

    /** @test */
    public function the_list_endpoint_does_not_carry_the_parties_block_but_uses_snapshot_values_when_partner_is_loaded(): void
    {
        $posted = $this->posted();
        $this->customer->update(['name' => 'اسم عميل جديد']);

        $row = collect($this->withToken($this->auth['token'])->getJson('/api/invoices')->assertOk()['data'])
            ->firstWhere('id', $posted->id);
        $this->assertArrayNotHasKey('parties', $row);
    }

    /** @test */
    public function the_public_api_shows_the_snapshot_buyer_name_for_a_posted_invoice(): void
    {
        $posted = $this->posted();
        $this->customer->update(['name' => 'اسم عميل جديد']);

        $resource = (new \App\Http\Resources\PublicInvoiceResource(Invoice::with('partner')->findOrFail($posted->id)))
            ->resolve(request());
        $this->assertSame('شركة الأمل', $resource['partner']['name']);
        $this->assertSame($this->customer->code, $resource['partner']['code']);
    }

    // ───────────────────────── الفشل والإعادة ─────────────────────────

    /** @test */
    public function a_failed_posting_rolls_back_the_snapshot_and_the_retry_captures_current_data(): void
    {
        $draft = $this->draft();

        app()->bind(InvoiceService::class, fn ($app) => $app->build(Rem04FlakyInvoiceService::class));
        Rem04FlakyInvoiceService::reset(1, 'HY000');
        try {
            app(InvoiceService::class)->post($draft);
            $this->fail('كان يجب أن يفشل الترحيل المحقون.');
        } catch (QueryException) {
            // متوقع: الفشل في settle() بعد كتابة issued_at واللقطة والقيد.
        }
        $this->assertNull($this->raw($draft->id), 'اللقطة تراجعت مع المعاملة');
        $this->assertSame('draft', DB::table('invoices')->where('id', $draft->id)->value('status'));

        $this->customer->update(['name' => 'اسم قبل إعادة المحاولة']);
        $posted = app(InvoiceService::class)->post(Invoice::findOrFail($draft->id));

        $this->assertSame('اسم قبل إعادة المحاولة', $posted->fresh()->party_snapshot['buyer']['name']);
    }

    /** @test */
    public function a_second_post_is_rejected_and_the_snapshot_is_untouched(): void
    {
        $posted = $this->posted();
        $before = $this->raw($posted->id);
        $this->customer->update(['name' => 'اسم آخر']);

        try {
            app(InvoiceService::class)->post(Invoice::findOrFail($posted->id));
            $this->fail('الترحيل الثاني يجب أن يُرفض.');
        } catch (\RuntimeException) {
        }

        $this->assertSame($before, $this->raw($posted->id));
    }

    // ───────────────────────── الثبات وحدود Eloquent ─────────────────────────

    /** @test */
    public function the_snapshot_cannot_be_modified_or_cleared_after_it_is_persisted(): void
    {
        $posted = $this->posted();
        $before = $this->raw($posted->id);

        $mutations = [
            'تعديل' => fn (Invoice $i) => $i->forceFill(['party_snapshot' => ['v' => 1, 'seller' => ['name' => 'x'], 'buyer' => ['name' => 'y']]])->save(),
            'مسح' => fn (Invoice $i) => $i->forceFill(['party_snapshot' => null])->save(),
            'عبر update()' => fn (Invoice $i) => $i->forceFill(['party_snapshot' => ['v' => 1]])->update(['notes' => 'n']),
        ];
        foreach ($mutations as $label => $mutation) {
            try {
                $mutation(Invoice::findOrFail($posted->id));
                $this->fail("كان يجب رفض: {$label}");
            } catch (LogicException $e) {
                $this->assertStringContainsString('party_snapshot', $e->getMessage(), $label);
            }
        }
        $this->assertSame($before, $this->raw($posted->id));

        // إعادة إسناد القيمة نفسها (بترتيب مفاتيح مختلف) ليست تعديلاً.
        $model = Invoice::findOrFail($posted->id);
        $same = $model->party_snapshot;
        $model->forceFill(['party_snapshot' => $same])->update(['notes' => 'ملاحظة بعد الترحيل']);
        $this->assertSame('ملاحظة بعد الترحيل', Invoice::findOrFail($posted->id)->notes);
    }

    /** @test */
    public function a_partially_loaded_model_cannot_bypass_the_write_once_guard(): void
    {
        $posted = $this->posted();
        $before = $this->raw($posted->id);

        // حدّ Eloquent: العمود غير محمَّل ⇒ لا قيمة أصلية في النموذج؛ الحارس يقرأ المخزَّن من الصف بلا نطاقات.
        $partial = Invoice::query()->select('id', 'tenant_id', 'status')->findOrFail($posted->id);
        $partial->forceFill(['party_snapshot' => ['v' => 1, 'seller' => [], 'buyer' => []]]);
        try {
            $partial->save();
            $this->fail('النموذج الجزئي تجاوز الحارس.');
        } catch (LogicException) {
        }

        $partial = Invoice::query()->select('id', 'tenant_id', 'status')->findOrFail($posted->id);
        $partial->forceFill(['issued_at' => '2031-01-01 00:00:00']);
        try {
            $partial->save();
            $this->fail('النموذج الجزئي تجاوز حارس issued_at.');
        } catch (LogicException) {
        }

        $this->assertSame($before, $this->raw($posted->id));
    }

    /** @test */
    public function mass_assignment_and_client_input_cannot_inject_or_overwrite_a_snapshot(): void
    {
        $fake = ['v' => 1, 'seller' => ['name' => 'مزوَّر'], 'buyer' => ['name' => 'مزوَّر']];

        // الخدمة تتجاهل المفتاح، وfill() لا يقبله.
        $viaService = app(InvoiceService::class)->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'credit', 'party_snapshot' => $fake],
            [['description' => 'خدمة', 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
        );
        $this->assertNull($this->raw($viaService->id));
        Invoice::findOrFail($viaService->id)->fill(['party_snapshot' => $fake])->save();
        $this->assertNull($this->raw($viaService->id));

        // API: إنشاء وتعديل بمفتاح party_snapshot/parties يُتجاهلان، ثم الترحيل يلتقط الحقيقي.
        $id = $this->withToken($this->auth['token'])->postJson('/api/invoices', [
            'partner_id' => $this->customer->id, 'payment_type' => 'credit', 'party_snapshot' => $fake, 'parties' => $fake,
            'items' => [['description' => 'خدمة', 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
        ])->assertCreated()->assertJsonPath('data.parties', null)['data']['id'];
        $this->withToken($this->auth['token'])->putJson("/api/invoices/{$id}", [
            'partner_id' => $this->customer->id, 'party_snapshot' => $fake,
            'items' => [['description' => 'خدمة', 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
        ])->assertOk();
        $this->assertNull($this->raw($id));

        $this->withToken($this->auth['token'])->postJson("/api/invoices/{$id}/post", ['party_snapshot' => $fake])->assertOk();
        $snapshot = json_decode((string) $this->raw($id), true);
        $this->assertSame('شركة الأفق', $snapshot['seller']['name']);

        // محاولات الكتابة على فاتورة مرحَّلة عبر الـAPI مرفوضة ولا تغيّر اللقطة.
        $before = $this->raw($id);
        $this->withToken($this->auth['token'])->putJson("/api/invoices/{$id}", [
            'partner_id' => $this->customer->id, 'party_snapshot' => $fake,
            'items' => [['description' => 'خدمة', 'quantity' => 1, 'unit_price' => 1, 'tax_rate' => 15]],
        ])->assertStatus(422);
        $this->withToken($this->auth['token'])->deleteJson("/api/invoices/{$id}")->assertStatus(422);
        $this->assertSame($before, $this->raw($id));
    }

    /** @test */
    public function no_application_code_writes_the_write_once_columns_outside_the_posting_path(): void
    {
        // حارس ساكن: أي مسار كتابة التفافي (Builder/DB/SQL خام/الصامت) على جدول الفواتير يُفشل الاختبار فيُراجَع.
        $app = base_path('app');
        $offenders = [];
        $iterator = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($app, \FilesystemIterator::SKIP_DOTS));
        foreach ($iterator as $file) {
            if ($file->getExtension() !== 'php') {
                continue;
            }
            $path = str_replace(base_path().'/', '', $file->getPathname());
            // التعليقات لا تُعدّ كتابةً (التوثيق نفسه يذكر هذه الأنماط).
            $code = preg_replace(['#/\*.*?\*/#s', '#(?<![:\'"])//[^\n]*#'], '', file_get_contents($file->getPathname()));

            // 1) كتابة مباشرة على جدول invoices خارج النموذج.
            if (preg_match('/DB::table\(\s*[\'"]invoices[\'"]\s*\)\s*->\s*(update|insert|upsert|delete|increment|decrement)/', $code)
                || preg_match('/\b(UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+"?invoices"?\b/i', $code)) {
                $offenders[] = "{$path}: كتابة مباشرة على invoices";
            }
            // 2) تحديث جماعي عبر Builder الفاتورة.
            if (preg_match('/Invoice::[^;]*?->\s*(update|upsert|insert|insertOrIgnore|increment|decrement)\s*\(/s', $code)) {
                $offenders[] = "{$path}: تحديث جماعي عبر Invoice builder";
            }
            // 3) كتابة صامتة (بلا أحداث) على نموذج الفاتورة.
            if (str_contains($code, 'Invoice::withoutEvents') || preg_match('/\$invoice\w*->\s*(saveQuietly|updateQuietly)\s*\(/', $code)) {
                $offenders[] = "{$path}: كتابة صامتة على الفاتورة";
            }
        }
        $this->assertSame([], $offenders);

        // الأعمدة مكتوبة الإسناد (key => …) من ملفين فقط: خدمة الترحيل (الكاتب) والنموذج/الحامل (الحارس والتحويل).
        $writers = [];
        foreach ($iterator as $file) {
            if ($file->getExtension() === 'php' && preg_match('/[\'"]party_snapshot[\'"]\s*=>/', file_get_contents($file->getPathname()))) {
                $writers[] = str_replace(base_path().'/', '', $file->getPathname());
            }
        }
        sort($writers);
        $this->assertSame(
            ['app/Models/Invoice.php', 'app/Services/Accounting/InvoiceService.php'],
            $writers,
            'أي كاتب جديد لـ party_snapshot يجب أن يُراجَع صراحةً.'
        );
        $fillable = (new Invoice())->getFillable();
        $this->assertNotContains('party_snapshot', $fillable);
        $this->assertNotContains('issued_at', $fillable);
    }

    // ───────────────────────── المسارات الأخرى ─────────────────────────

    /** @test */
    public function duplicating_an_invoice_creates_a_new_draft_without_the_historical_snapshot(): void
    {
        $posted = $this->posted();

        $copy = $this->withToken($this->auth['token'])->postJson("/api/invoices/{$posted->id}/duplicate")
            ->assertCreated()->assertJsonPath('data.status', 'draft')->assertJsonPath('data.parties', null);

        $this->assertNull($this->raw($copy['data']['id']));
        $this->assertNotNull($this->raw($posted->id));
    }

    /** @test */
    public function missing_optional_identity_data_never_blocks_posting(): void
    {
        $this->tenant->update(['cr_number' => null, 'vat_number' => null]);
        Settings::put('company', ['building_no' => '', 'street' => '', 'additional_no' => '', 'district' => '', 'city' => '', 'postal_code' => '', 'short_address' => '', 'phone' => '', 'mobile' => '']);
        $bare = Partner::create(['name' => 'عميل نقدي', 'type' => 'customer']);

        $posted = $this->posted($bare);
        $snapshot = $posted->fresh()->party_snapshot;

        $this->assertSame('posted', $posted->status);
        $this->assertSame(1, $snapshot['v']);
        $this->assertNull($snapshot['seller']['vat_number']);
        $this->assertNull($snapshot['seller']['cr_number']);
        $this->assertSame(['building_no' => null, 'street' => null, 'additional_no' => null, 'district' => null, 'city' => null, 'postal_code' => null, 'short_address' => null], $snapshot['seller']['address']);
        $this->assertSame('عميل نقدي', $snapshot['buyer']['name']);
        $this->assertNull($snapshot['buyer']['vat_number']);
        $this->assertNull($snapshot['buyer']['address']['street']);
    }

    // ───────────────────────── لا أثر على ZATCA أو المال ─────────────────────────

    /** @test */
    public function zatca_artifacts_totals_ledger_and_icv_are_unaffected_by_the_snapshot(): void
    {
        $first = $this->posted();
        $xml = (string) $first->zatca_xml;

        // XML ما زال يحمل ما كان يحمله فقط: رقم البائع واسمه، واسم المشتري — لا عنوان ولا CRN ولا رقم المشتري (يُصحَّح في REM-15/16).
        $this->assertStringContainsString('<cbc:CompanyID>300000000000003</cbc:CompanyID>', $xml);
        $this->assertStringContainsString('<cbc:RegistrationName>شركة الأفق</cbc:RegistrationName>', $xml);
        $this->assertStringContainsString('<cbc:RegistrationName>شركة الأمل</cbc:RegistrationName>', $xml);
        foreach (['1010101010', '12643', '8228', '300111222333003', 'PostalAddress', 'PartyIdentification'] as $absent) {
            $this->assertStringNotContainsString($absent, $xml, $absent);
        }
        $this->assertSame(app(ZatcaInvoiceHasher::class)->hash($xml), $first->zatca_hash);

        // المبالغ والقيد وICV كما كانت، وسلسلة PIH سليمة.
        $this->assertSame([100000, 15000, 115000], [(int) $first->subtotal, (int) $first->tax_amount, (int) $first->total]);
        $lines = JournalLine::where('journal_entry_id', $first->journal_entry_id)->get();
        $this->assertSame([115000, 115000], [(int) $lines->sum('debit'), (int) $lines->sum('credit')]);
        $this->assertSame(1, JournalEntry::where('source_type', Invoice::class)->where('source_id', $first->id)->count());

        $this->mutateLiveMasterData();
        $second = $this->posted();
        $this->assertSame([1, 2], [(int) $first->zatca_icv, (int) $second->zatca_icv]);
        $this->assertSame(app(ZatcaInvoiceHasher::class)->hash($xml), $second->zatca_previous_hash);
        // البائع/المشتري في XML الجديد ما زالا يقرآن حيّاً (لم يُغيَّر المولِّد): دليل أن REM-14 لا يمسّ XML.
        $this->assertStringContainsString('<cbc:RegistrationName>اسم جديد للمؤسسة</cbc:RegistrationName>', $second->zatca_xml);
    }

    // ───────────────────────── العزل ─────────────────────────

    /** @test */
    public function snapshots_are_tenant_and_branch_isolated_and_respect_invoice_permissions(): void
    {
        $khobar = $this->withToken($this->auth['token'])->postJson('/api/branches', ['name' => 'فرع الخبر'])->assertCreated()['data']['id'];
        $main = $this->withToken($this->auth['token'])->getJson('/api/branches')['data'][0]['id'];

        $invoiceId = $this->withToken($this->auth['token'])->withHeaders(['X-Branch-Id' => $khobar])->postJson('/api/invoices', [
            'partner_id' => $this->customer->id, 'payment_type' => 'credit',
            'items' => [['description' => 'خدمة', 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
        ])->assertCreated()['data']['id'];
        $this->withToken($this->auth['token'])->withHeaders(['X-Branch-Id' => $khobar])->postJson("/api/invoices/{$invoiceId}/post")->assertOk();

        // الفرع الصاحب يرى اللقطة؛ لقطة الفرع تحمل فرعه.
        $this->show($invoiceId, null, ['X-Branch-Id' => $khobar])->assertOk()
            ->assertJsonPath('data.parties.seller.branch_id', $khobar);
        $this->assertSame($khobar, json_decode((string) $this->raw($invoiceId), true)['seller']['branch_id']);

        // مستأجر آخر لا يصل إليها إطلاقاً.
        $other = $this->registerTenant('party-snap-b', 'party-snap-b@example.test');
        $this->show($invoiceId, $other['token'])->assertNotFound();

        // مستخدم بلا صلاحية قراءة الفواتير لا يراها.
        app(TenantContext::class)->set($this->auth['tenant_id']);
        $viewerless = $this->tokenForRole($this->auth['tenant_id'], 'hr', 'hr-party@example.test');
        $this->show($invoiceId, $viewerless)->assertForbidden();

        // ولا تُنسخ اللقطة بين المستأجرين: مستأجر آخر يرحّل فاتورته بلقطته الخاصة.
        app(TenantContext::class)->set($other['tenant_id']);
        $theirs = Partner::create(['name' => 'عميلهم', 'type' => 'customer']);
        $posted = app(InvoiceService::class)->post(app(InvoiceService::class)->create(
            ['partner_id' => $theirs->id, 'payment_type' => 'credit'],
            [['description' => 'خدمة', 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
        ));
        $theirSnapshot = $posted->fresh()->party_snapshot;
        $this->assertSame($other['tenant_id'], $theirSnapshot['seller']['tenant_id']);
        $this->assertSame('عميلهم', $theirSnapshot['buyer']['name']);
        $this->assertNotSame('شركة الأفق', $theirSnapshot['seller']['name']);
    }

    // ───────────────────────── الهجرة ─────────────────────────

    /** @test */
    public function the_migration_is_additive_nullable_and_never_backfills_existing_rows(): void
    {
        $posted = $this->posted();
        DB::table('invoices')->where('id', $posted->id)->update(['party_snapshot' => null]);

        $migration = require base_path('database/migrations/2026_11_12_010000_add_party_snapshot_to_invoices.php');
        $migration->down();
        $this->assertFalse(Schema::hasColumn('invoices', 'party_snapshot'));

        $migration->up();
        $this->assertTrue(Schema::hasColumn('invoices', 'party_snapshot'));
        $this->assertNull(DB::table('invoices')->where('id', $posted->id)->value('party_snapshot'), 'لا ملء رجعي');
        $this->assertSame($posted->zatca_hash, DB::table('invoices')->where('id', $posted->id)->value('zatca_hash'));
    }
}
