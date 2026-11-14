<?php

namespace Tests\Feature;

use App\Models\Employee;
use App\Models\FuelNozzle;
use App\Models\FuelPump;
use App\Models\FuelShift;
use App\Models\FuelTanker;
use App\Models\FuelTankerFill;
use App\Models\FuelTankerOwner;
use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\Payment;
use App\Models\StockMovement;
use App\Models\User;
use App\Support\FuelStaffTemplates;
use App\Support\Rbac;
use App\Support\StationSessionBoundary;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Route;
use Tests\TestCase;

/**
 * TANKER-PR7 — تسجيل تعبئة صهريج من تطبيق المحطات بجلسة الموظف (رقم الموظف + PIN، توكن `station-ops`):
 * القائمة البيضاء (أربع قراءات وكتابة واحدة)، تسجيل كامل بلا أي أثر مخزني/محاسبي، idempotency، رفض الوردية المفقودة/الفوهة/الكمية/السعة،
 * عزل المؤسسات والمحطات والفروع، منع كل المسارات المالية والتشغيلية الأخرى عن جلسة PIN (حتى لمالك/مدير)، والبوابتان المغلقتان، وتطابق التوسيع المقترح للقالب مع مسارات القائمة.
 */
class FuelTankerFillStationSessionTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use BuildsFuelStaffFixture;

    private const BASE = '/api/fuel-stations/tanker-fills';
    private const PIN = '482915';
    private const HOST = 'http://fuel-b3.awj.app/api/';

    private FuelNozzle $nozzle;
    private FuelTankerOwner $owner;
    private FuelTanker $tanker;
    private FuelShift $shift;
    private int $seq = 0;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        config(['fuel_stations.tanker_management_enabled' => true, 'fuel_stations.tanker_fills_enabled' => true]);
        $this->buildFixture();
        app(TenantContext::class)->set($this->tenantId);
        $pump = FuelPump::create(['branch_id' => $this->fx['branchA']->id, 'fuel_station_id' => $this->fx['s1']->id, 'pump_number' => '02', 'name' => 'مضخة 2']);
        $this->nozzle = $this->nozzle($this->fx['s1'], $pump, $this->fx['t1'], '1');
        $this->owner = FuelTankerOwner::create(['name' => 'عسكر', 'code' => 'ASK', 'status' => 'active', 'phone' => '0555555555', 'notes' => 'ملاحظة داخلية']);
        $this->tanker = FuelTanker::create(['fuel_tanker_owner_id' => $this->owner->id, 'plate_number' => 'أ ب ج 1234', 'plate_key' => 'ABJ1234', 'capacity_milliliters' => 5_000_000, 'status' => 'active', 'notes' => 'سري']);
        $this->shift = $this->openShift($this->fx['s1'], 'FSH-P7-1');
    }

    // ───────────────────────── أدوات ─────────────────────────

    private function nozzle($station, FuelPump $pump, $tank, string $number, array $extra = []): FuelNozzle
    {
        return FuelNozzle::create($extra + [
            'branch_id' => $station->branch_id, 'fuel_station_id' => $station->id, 'fuel_pump_id' => $pump->id, 'fuel_tank_id' => $tank->id,
            'fuel_product_id' => $this->fx['fuel']->id, 'nozzle_number' => $number,
        ]);
    }

    private function openShift($station, string $number): FuelShift
    {
        return FuelShift::create([
            'branch_id' => $station->branch_id, 'fuel_station_id' => $station->id, 'number' => $number, 'status' => FuelShift::STATUS_OPEN,
            'opening_float_minor' => 0, 'idempotency_key' => 'shift-' . $number, 'opened_by' => $this->makeUser('seller-' . $number, 'role-seller-' . $number, ['fuel_stations.view'])['user']->id, 'opened_at' => now(),
        ]);
    }

    /**
     * موظف محطة بجلسة PIN حقيقية الشكل (توكن `station-ops` وحده) ومرتبط بسجل موظف نشط.
     *
     * @param  list<string>  $permissions
     * @param  list<string>|null  $stations
     * @return array{user: User, employee: Employee, session: string}
     */
    private function worker(array $permissions, ?array $stations = null, string $role = 'worker'): array
    {
        $n = ++$this->seq;
        $made = $this->makeUser("w{$n}", "role-p7-{$n}", array_merge(['fuel_stations.view'], $permissions), $stations);

        return $this->attachEmployee($made['user']);
    }

    /** @return array{user: User, employee: Employee, session: string} */
    private function attachEmployee(User $user): array
    {
        app(TenantContext::class)->set($this->tenantId);
        $employee = Employee::create(['employee_no' => Employee::nextDocumentNumber('EMP'), 'name' => $user->name, 'basic_salary' => 0, 'is_active' => true]);
        $user->forceFill(['employee_id' => $employee->id, 'station_pin_hash' => Hash::make(self::PIN), 'station_pin_set_at' => now()])->save();

        return ['user' => $user, 'employee' => $employee, 'session' => $user->createToken(StationSessionBoundary::TOKEN_NAME, [StationSessionBoundary::ABILITY])->plainTextToken];
    }

    /** @return list<string> */
    private function recorder(): array
    {
        return FuelStaffTemplates::PROPOSED_TANKER_FILL_RECORDING;
    }

    /** @param array<string,mixed> $over @return array<string,mixed> */
    private function payload(array $over = []): array
    {
        return $over + [
            'fuel_station_id' => $this->fx['s1']->id, 'fuel_nozzle_id' => $this->nozzle->id, 'fuel_tanker_owner_id' => $this->owner->id, 'fuel_shift_id' => $this->shift->id,
            'voucher_number' => '04052', 'quantity_liters' => '2000', 'idempotency_key' => 'p7-key-' . (++$this->seq) . '-abcdef',
        ];
    }

    /** @return array<string,int> */
    private function footprint(): array
    {
        return [
            'stock_movements' => StockMovement::query()->count(), 'journal_entries' => JournalEntry::query()->count(),
            'invoices' => Invoice::query()->count(), 'payments' => Payment::query()->count(),
            'cost_movements' => DB::table('fuel_inventory_cost_movements')->count(), 'postings' => DB::table('fuel_tanker_fill_inventory_postings')->count(),
            'ledger' => DB::table('fuel_operational_ledgers')->count(),
        ];
    }

    // ───────────────────────── القائمة البيضاء ─────────────────────────

    /** @test */
    public function the_boundary_allows_exactly_four_tanker_reads_and_one_tanker_write(): void
    {
        foreach ([
            ['GET', 'api/fuel-stations/tanker-fills'], ['HEAD', 'api/fuel-stations/tanker-fills'], ['GET', 'api/fuel-stations/tanker-fills/{id}'],
            ['GET', 'api/fuel-stations/tanker-owners'], ['GET', 'api/fuel-stations/tankers'], ['POST', 'api/fuel-stations/tanker-fills'],
        ] as [$method, $uri]) {
            $this->assertTrue(StationSessionBoundary::routeAllowed($method, $uri), "{$method} {$uri}");
        }

        foreach ([
            // إلغاء وترحيل وعكس ومعاينتاهما
            ['POST', 'api/fuel-stations/tanker-fills/{id}/void'], ['POST', 'api/fuel-stations/tanker-fills/{id}/inventory-posting'], ['GET', 'api/fuel-stations/tanker-fills/{id}/inventory-posting/preview'],
            ['POST', 'api/fuel-stations/tanker-fills/{id}/inventory-reversal'], ['GET', 'api/fuel-stations/tanker-fills/{id}/inventory-reversal/preview'],
            // مراجعة الدمج والمساحة والتقارير والإعدادات والمطابقة
            ['GET', 'api/fuel-stations/tanker-fills/inventory-review'], ['GET', 'api/fuel-stations/tanker-fills/inventory-review/reconciliation'], ['GET', 'api/fuel-stations/tanker-fills/inventory-settings'],
            ['GET', 'api/fuel-stations/tanker-fills/inventory-workspace'], ['GET', 'api/fuel-stations/tanker-fills/{id}/inventory'], ['GET', 'api/fuel-stations/tanker-fill-reports/{key}'],
            // المرفقات (توسيعها مقترح لا مفعَّل)
            ['GET', 'api/fuel-stations/tanker-fills/{id}/attachments'], ['POST', 'api/fuel-stations/tanker-fills/{id}/attachments'], ['GET', 'api/fuel-stations/tanker-fills/{id}/attachments/{attachmentId}/download'],
            ['POST', 'api/fuel-stations/tanker-fills/{id}/attachments/{attachmentId}/replace'], ['DELETE', 'api/fuel-stations/tanker-fills/{id}/attachments/{attachmentId}'],
            // ملف الصاحب وربط الشركات والكتابة
            ['GET', 'api/fuel-stations/tanker-owners/{id}'], ['GET', 'api/fuel-stations/tanker-owners/{id}/company-links'], ['POST', 'api/fuel-stations/tanker-owners'], ['PUT', 'api/fuel-stations/tankers/{id}'],
            // تعديل/حذف السند ومتغيرات المسار
            ['PUT', 'api/fuel-stations/tanker-fills'], ['PATCH', 'api/fuel-stations/tanker-fills/{id}'], ['DELETE', 'api/fuel-stations/tanker-fills/{id}'], ['POST', 'api/fuel-stations/tanker-fills/{id}'],
            ['GET', 'api/fuel-stations/tanker-fills-evil'], ['GET', 'api/fuel-stations/tanker-fills/{id}/anything'], ['GET', 'api/fuel-stations/tankers/{id}'], ['GET', 'api/fuel-stations/tanker-owners/x/y'],
        ] as [$method, $uri]) {
            $this->assertFalse(StationSessionBoundary::routeAllowed($method, $uri), "{$method} {$uri} must stay denied to a PIN session");
        }
    }

    /** @test */
    public function every_tanker_route_that_exists_is_classified_and_only_the_five_are_reachable(): void
    {
        $reachable = [];
        foreach (Route::getRoutes() as $route) {
            $uri = $route->uri();
            if (! str_starts_with($uri, 'api/fuel-stations/tanker')) {
                continue;
            }
            foreach (array_diff($route->methods(), ['HEAD']) as $method) {
                if (StationSessionBoundary::routeAllowed($method, $uri)) {
                    $reachable[] = "{$method} " . substr($uri, strlen('api/fuel-stations/'));
                }
            }
        }
        sort($reachable);
        $this->assertSame(['GET tanker-fills', 'GET tanker-fills/{id}', 'GET tanker-owners', 'GET tankers', 'POST tanker-fills'], $reachable, 'أي مسار صهاريج جديد محجوب افتراضياً لجلسة PIN');
    }

    /** @test */
    public function the_proposed_template_matches_exactly_what_the_whitelisted_routes_require_and_nothing_is_granted_automatically(): void
    {
        $required = [];
        foreach (Route::getRoutes() as $route) {
            if (! str_starts_with($route->uri(), 'api/fuel-stations/tanker')) {
                continue;
            }
            foreach (array_diff($route->methods(), ['HEAD']) as $method) {
                if (! StationSessionBoundary::routeAllowed($method, $route->uri())) {
                    continue;
                }
                foreach ($route->gatherMiddleware() as $middleware) {
                    if (is_string($middleware) && str_contains($middleware, 'EnsurePermission:')) {
                        $required[] = substr($middleware, strpos($middleware, 'EnsurePermission:') + strlen('EnsurePermission:'));
                    }
                }
            }
        }
        $required = array_values(array_unique($required));
        sort($required);
        $proposal = FuelStaffTemplates::PROPOSED_TANKER_FILL_RECORDING;
        sort($proposal);
        $this->assertSame($proposal, $required, 'التوسيع المقترح = صلاحيات المسارات المسموحة بالضبط');

        // غير مفعَّل: لا قالب يحمل أيّاً منها، ولا الاقتراحان داخل `all()`.
        foreach ([...FuelStaffTemplates::PROPOSED_TANKER_FILL_RECORDING, ...FuelStaffTemplates::PROPOSED_TANKER_FILL_ATTACHMENT_UPLOAD] as $permission) {
            foreach (FuelStaffTemplates::all() as $template => $definition) {
                $this->assertNotContains($permission, $definition['permissions'], "قالب {$template} لا يمنح {$permission} قبل اعتماد المالك");
            }
            $this->assertContains($permission, Rbac::PERMISSIONS, "{$permission} معرَّف في Rbac");
            $this->assertContains($permission, FuelStaffTemplates::grantableAll(['*']), "{$permission} يُمنح فردياً من حامل * (قبل الاعتماد)");
        }

        // لا شيء مالي ولا تشغيلي حسّاس في الاقتراح.
        foreach (['fuel.tanker.fill.void', 'fuel.tanker.manage', 'products.view_cost', 'accounts.view', 'fuel.governance.manage', 'fuel.staff.manage', 'fuel.tanker.fill.attachment.add', 'fuel.tanker.fill.attachment.remove'] as $forbidden) {
            $this->assertNotContains($forbidden, FuelStaffTemplates::PROPOSED_TANKER_FILL_RECORDING);
        }
        foreach (FuelStaffTemplates::PROPOSED_TANKER_FILL_RECORDING as $permission) {
            $this->assertStringNotContainsString('inventory', $permission);
        }
        $this->assertSame(['fuel.tanker.fill.attachment.add'], FuelStaffTemplates::PROPOSED_TANKER_FILL_ATTACHMENT_UPLOAD);
    }

    // ───────────────────────── التسجيل ─────────────────────────

    /** @test */
    public function a_pin_session_records_a_fill_and_it_stays_pending_with_no_stock_ledger_invoice_or_payment_effect(): void
    {
        $w = $this->worker($this->recorder());
        $before = $this->footprint();

        $created = $this->withToken($w['session'])->postJson(self::BASE, $this->payload())->assertCreated();
        $id = $created->json('data.id');
        $this->assertSame('recorded', $created->json('data.status'));
        $this->assertSame('pending_integration', $created->json('data.inventory_status'));
        $this->assertSame('04052', $created->json('data.voucher_number'));
        $this->assertStringStartsWith('FTF-', $created->json('data.number'));
        $this->assertSame($this->shift->id, $created->json('data.fuel_shift_id'));
        $this->assertSame($w['user']->id, $created->json('data.recorded_by'));
        $this->assertSame($this->fx['t1']->id, $created->json('data.fuel_tank_id'), 'الخزان من الفوهة');
        $this->assertSame($this->fx['fuel']->id, $created->json('data.fuel_product_id'), 'المنتج من الفوهة');
        $this->assertSame(2_000_000, $created->json('data.quantity_milliliters'));

        $this->assertSame($before, $this->footprint(), 'تسجيل السند وحده لا يخصم مخزوناً ولا يقيّد ولا يفوتر ولا يحصّل');
        $this->assertSame(0, DB::table('fuel_tanker_fill_inventory_postings')->where('fuel_tanker_fill_id', $id)->count());

        $this->withToken($w['session'])->getJson(self::BASE . "?shift_id={$this->shift->id}")->assertOk()->assertJsonPath('data.0.id', $id);
        $this->withToken($w['session'])->getJson(self::BASE . "/{$id}")->assertOk()->assertJsonPath('data.inventory_status', 'pending_integration');
    }

    /** @test */
    public function a_voucher_with_leading_zeros_is_stored_verbatim_and_arabic_digits_are_normalised(): void
    {
        $w = $this->worker($this->recorder());
        $a = $this->withToken($w['session'])->postJson(self::BASE, $this->payload(['voucher_number' => '00077']))->assertCreated();
        $this->assertSame('00077', $a->json('data.voucher_number'));
        $b = $this->withToken($w['session'])->postJson(self::BASE, $this->payload(['voucher_number' => '٠٠٠٧٨']))->assertCreated();
        $this->assertSame('00078', $b->json('data.voucher_number'));
        $this->withToken($w['session'])->postJson(self::BASE, $this->payload(['voucher_number' => '77']))->assertCreated();
    }

    /** @test */
    public function replaying_the_same_attempt_returns_the_first_fill_and_never_duplicates(): void
    {
        $w = $this->worker($this->recorder());
        $body = $this->payload();
        $first = $this->withToken($w['session'])->postJson(self::BASE, $body)->assertCreated();
        $replay = $this->withToken($w['session'])->postJson(self::BASE, $body)->assertOk();
        $this->assertTrue($replay->json('meta.replayed'));
        $this->assertSame($first->json('data.id'), $replay->json('data.id'));
        $this->assertSame(1, FuelTankerFill::query()->count());

        // المفتاح نفسه بمحتوى مختلف ⇒ 409، لا سند ثانٍ.
        $this->withToken($w['session'])->postJson(self::BASE, array_merge($body, ['quantity_liters' => '2500']))->assertStatus(409)->assertJsonPath('reason', 'idempotency_key_reused');
        // سند ورقي مكرر بمفتاح جديد ⇒ 409 وسند واحد فقط.
        $this->withToken($w['session'])->postJson(self::BASE, $this->payload(['voucher_number' => '04052', 'idempotency_key' => 'p7-other-key-12345']))->assertStatus(409)->assertJsonPath('reason', 'voucher_duplicate');
        // الأصفار البادئة جزء من السند: «4052» سند آخر لا مكرر لـ«04052».
        $this->withToken($w['session'])->postJson(self::BASE, $this->payload(['voucher_number' => '4052']))->assertCreated();
        $this->assertSame(2, FuelTankerFill::query()->count());
    }

    // ───────────────────────── هوية المحاولة (attempt_key) ─────────────────────────

    /** @return array<string,mixed> */
    private function lookup(string $session, string $key, string $extra = ''): array
    {
        return $this->withToken($session)->getJson(self::BASE . '?attempt_key=' . urlencode($key) . $extra)->assertOk()->json();
    }

    /** @test */
    public function two_identical_fills_are_told_apart_by_the_attempt_key_never_by_content(): void
    {
        // منع تكرار السند معطَّل: سندان متطابقان تماماً (السند والكمية والفوهة والوردية) يُسجَّلان بمفتاحين مختلفين.
        $this->withToken($this->fx['owner'])->putJson('/api/fuel-stations/settings', ['tanker_voucher_unique_scope' => 'none', 'reason' => 'اختبار هوية المحاولة'])->assertOk();
        $w = $this->worker($this->recorder());
        $a = $this->payload(['voucher_number' => '9001', 'idempotency_key' => 'attempt-a-0123456789']);
        $b = $this->payload(['voucher_number' => '9001', 'idempotency_key' => 'attempt-b-0123456789']);
        $idA = $this->withToken($w['session'])->postJson(self::BASE, $a)->assertCreated()->json('data.id');
        $idB = $this->withToken($w['session'])->postJson(self::BASE, $b)->assertCreated()->json('data.id');
        $this->assertNotSame($idA, $idB);
        $this->assertSame(2, FuelTankerFill::query()->count());

        $foundA = $this->lookup($w['session'], $a['idempotency_key']);
        $foundB = $this->lookup($w['session'], $b['idempotency_key']);
        $this->assertTrue($foundA['attempt']['applied']);
        $this->assertSame([$idA], array_column($foundA['data'], 'id'), 'مفتاح المحاولة أ يعيد سندها وحده رغم تطابق المحتوى مع ب');
        $this->assertSame([$idB], array_column($foundB['data'], 'id'));
    }

    /** @test */
    public function a_lost_attempt_is_not_confirmed_by_an_identical_older_fill(): void
    {
        $this->withToken($this->fx['owner'])->putJson('/api/fuel-stations/settings', ['tanker_voucher_unique_scope' => 'none', 'reason' => 'اختبار هوية المحاولة'])->assertOk();
        $w = $this->worker($this->recorder());
        $this->withToken($w['session'])->postJson(self::BASE, $this->payload(['voucher_number' => '9002', 'idempotency_key' => 'older-attempt-0123456']))->assertCreated();

        // محاولة ثانية بالمحتوى نفسه ضاع طلبها قبل أن يصل الخادم: لا سند لها.
        $missing = $this->lookup($w['session'], 'never-reached-0123456');
        $this->assertTrue($missing['attempt']['applied']);
        $this->assertSame([], $missing['data'], 'لا تأكيد بالمطابقة على المحتوى: السند الأقدم ليس هذه المحاولة');
    }

    /** @test */
    public function the_attempt_lookup_is_bound_to_the_recording_user_and_never_exposes_keys(): void
    {
        $w = $this->worker($this->recorder());
        $mate = $this->worker($this->recorder());
        $body = $this->payload(['idempotency_key' => 'owned-attempt-0123456789']);
        $id = $this->withToken($w['session'])->postJson(self::BASE, $body)->assertCreated()->json('data.id');

        $own = $this->withToken($w['session'])->getJson(self::BASE . '?attempt_key=' . $body['idempotency_key'])->assertOk();
        $this->assertSame([$id], array_column($own->json('data'), 'id'));
        foreach (['idempotency_key', 'request_fingerprint'] as $leak) {
            $this->assertStringNotContainsString($leak, $own->getContent());
        }
        $this->assertStringNotContainsString($body['idempotency_key'], $own->getContent(), 'المفتاح لا يُعاد في أي استجابة');

        // زميل بالصلاحيات نفسها على المحطة نفسها وبحوزته المفتاح: لا يؤكد محاولة غيره.
        $this->assertSame([], $this->lookup($mate['session'], $body['idempotency_key'])['data']);
        // ولا يرى مفاتيح الآخرين ولا بياناتهم عبر القائمة العادية للمفتاح نفسه (يرى السند كسجل وردية فقط، بلا مفتاح).
        $this->assertStringNotContainsString($body['idempotency_key'], $this->withToken($mate['session'])->getJson(self::BASE)->assertOk()->getContent());
    }

    /** @test */
    public function the_attempt_lookup_respects_station_and_tenant_scope_and_validation(): void
    {
        $w = $this->worker($this->recorder(), [$this->fx['s1']->id]);
        $body = $this->payload(['idempotency_key' => 'scoped-attempt-0123456789']);
        $this->withToken($w['session'])->postJson(self::BASE, $body)->assertCreated();

        // الموظف نفسه بعد سحب إسناده من المحطة: لا يراها ولو كان هو من سجّل.
        $w['user']->fuelStations()->detach();
        $other = $this->worker($this->recorder(), [$this->fx['s2']->id]);
        $this->assertSame([], $this->lookup($other['session'], $body['idempotency_key'])['data']);

        // التحقق: مفتاح أقصر من 8 أو أطول من 128 ⇒ 422 لا مطابقة.
        $this->withToken($w['session'])->getJson(self::BASE . '?attempt_key=short')->assertStatus(422);
        $this->withToken($w['session'])->getJson(self::BASE . '?attempt_key=' . str_repeat('x', 129))->assertStatus(422);

        // بلا المعامل لا علامة `attempt` (القائمة العادية لا تدّعي مطابقة).
        $this->assertArrayNotHasKey('attempt', $this->withToken($w['session'])->getJson(self::BASE)->json());
    }

    /** @test */
    public function a_voided_fill_is_still_reported_for_its_attempt_and_the_lookup_never_changes_anything(): void
    {
        $w = $this->worker($this->recorder());
        $body = $this->payload(['idempotency_key' => 'voided-attempt-0123456789']);
        $id = $this->withToken($w['session'])->postJson(self::BASE, $body)->assertCreated()->json('data.id');
        $this->withToken($this->fx['owner'])->postJson(self::BASE . "/{$id}/void", ['reason' => 'اختبار'])->assertOk();

        $before = $this->footprint();
        $found = $this->lookup($w['session'], $body['idempotency_key']);
        $this->assertSame('voided', $found['data'][0]['status']);
        $this->assertSame($before, $this->footprint());
        $this->assertSame(1, FuelTankerFill::query()->count());

        // الإعادة بالمفتاح نفسه تعيد الأثر الأول ولا تنشئ سنداً جديداً.
        $this->withToken($w['session'])->postJson(self::BASE, $body)->assertOk()->assertJsonPath('data.id', $id);
        $this->assertSame(1, FuelTankerFill::query()->count());
    }

    /** @test */
    public function a_pin_session_can_use_the_attempt_lookup_but_still_cannot_reach_any_other_tanker_route(): void
    {
        $w = $this->worker($this->recorder());
        $body = $this->payload(['idempotency_key' => 'boundary-attempt-01234567']);
        $id = $this->withToken($w['session'])->postJson(self::BASE, $body)->assertCreated()->json('data.id');
        $this->lookup($w['session'], $body['idempotency_key']);

        foreach ([
            ['POST', self::BASE . "/{$id}/void", ['reason' => 'x']], ['POST', self::BASE . "/{$id}/inventory-posting", []], ['POST', self::BASE . "/{$id}/inventory-reversal", ['reason' => 'x']],
            ['GET', self::BASE . "/{$id}/inventory", []], ['GET', self::BASE . "/{$id}/attachments", []], ['GET', self::BASE . '/inventory-review', []],
        ] as [$method, $uri, $data]) {
            $this->withToken($w['session'])->json($method, $uri, $data)->assertForbidden();
        }
        $this->assertSame('pending_integration', FuelTankerFill::query()->findOrFail($id)->inventory_status);
    }

    /** @test */
    public function recording_is_rejected_without_an_open_shift_and_for_a_shift_that_is_not_the_current_one(): void
    {
        $w = $this->worker($this->recorder());
        // وردية غير الحالية (مغلقة) ⇒ مرفوضة.
        $stale = $this->shift;
        $stale->forceFill(['status' => FuelShift::STATUS_CLOSED, 'closed_at' => now()])->save();
        $this->withToken($w['session'])->postJson(self::BASE, $this->payload())->assertStatus(422)->assertJsonPath('reason', 'shift_required');
        $this->withToken($w['session'])->postJson(self::BASE, $this->payload(['fuel_shift_id' => null]))->assertStatus(422)->assertJsonPath('reason', 'shift_required');

        // وردية جديدة مفتوحة، والتطبيق ما زال يحمل معرّف القديمة ⇒ لا تُسجَّل على الجديدة بصمت.
        $this->openShift($this->fx['s1'], 'FSH-P7-2');
        $this->withToken($w['session'])->postJson(self::BASE, $this->payload(['fuel_shift_id' => $stale->id]))->assertStatus(422)->assertJsonPath('reason', 'shift_not_open');
        $this->assertSame(0, FuelTankerFill::query()->count());
    }

    /** @test */
    public function an_inactive_or_non_tanker_nozzle_and_invalid_quantities_are_rejected_with_no_fill(): void
    {
        $w = $this->worker($this->recorder());
        $pump = FuelPump::query()->where('fuel_station_id', $this->fx['s1']->id)->firstOrFail();
        $inactive = $this->nozzle($this->fx['s1'], $pump, $this->fx['t1'], '8', ['status' => 'inactive']);
        $directOnly = $this->nozzle($this->fx['s1'], $pump, $this->fx['t1'], '9', ['allowed_operations' => ['direct_sale']]);

        $this->withToken($w['session'])->postJson(self::BASE, $this->payload(['fuel_nozzle_id' => $inactive->id]))->assertStatus(422)->assertJsonPath('reason', 'equipment_not_operational');
        $this->withToken($w['session'])->postJson(self::BASE, $this->payload(['fuel_nozzle_id' => $directOnly->id]))->assertStatus(422)->assertJsonPath('reason', 'nozzle_operation_not_allowed');
        foreach (['0', '0.000', '-5', '-0.001', 'abc', '', '1.2345', '1e3'] as $bad) {
            $this->withToken($w['session'])->postJson(self::BASE, $this->payload(['quantity_liters' => $bad]))->assertStatus(422);
        }
        $this->assertSame(0, FuelTankerFill::query()->count());
    }

    /** @test */
    public function exceeding_the_tanker_capacity_needs_an_explicit_confirmation_under_the_default_policy(): void
    {
        $w = $this->worker($this->recorder());
        $over = $this->payload(['fuel_tanker_id' => $this->tanker->id, 'quantity_liters' => '6000']); // السعة 5000 لتر
        $this->withToken($w['session'])->postJson(self::BASE, $over)->assertStatus(422)->assertJsonPath('reason', 'capacity_overrun_confirmation_required');
        $this->assertSame(0, FuelTankerFill::query()->count());

        $confirmed = $this->withToken($w['session'])->postJson(self::BASE, $over + ['confirm_capacity_overrun' => true])->assertCreated();
        $this->assertSame(1_000_000, $confirmed->json('data.capacity_overrun_milliliters'));
        $this->assertSame($w['user']->id, $confirmed->json('data.capacity_overrun_confirmed_by'));

        // سياسة «منع»: التأكيد لا يكفي.
        $this->withToken($this->fx['owner'])->putJson('/api/fuel-stations/settings', ['tanker_capacity_overrun_policy' => 'block', 'reason' => 'اختبار PR-7'])->assertOk();
        $this->withToken($w['session'])->postJson(self::BASE, $this->payload(['fuel_tanker_id' => $this->tanker->id, 'quantity_liters' => '6000', 'voucher_number' => '9001', 'confirm_capacity_overrun' => true]))
            ->assertStatus(422)->assertJsonPath('reason', 'capacity_overrun_blocked');
    }

    /** @test */
    public function the_tanker_policy_of_the_station_is_readable_by_the_session_and_enforced_by_the_server(): void
    {
        $w = $this->worker($this->recorder());
        $read = $this->withToken($w['session'])->getJson("/api/fuel-stations/stations/{$this->fx['s1']->id}/settings")->assertOk();
        $this->assertFalse($read->json('data.tanker_selection_required'));
        $this->assertSame('allow_with_confirmation', $read->json('data.tanker_capacity_overrun_policy'));

        $this->withToken($this->fx['owner'])->putJson('/api/fuel-stations/settings', ['tanker_selection_required' => true, 'reason' => 'اختبار PR-7'])->assertOk();
        $this->withToken($w['session'])->postJson(self::BASE, $this->payload())->assertStatus(422)->assertJsonPath('reason', 'tanker_required');
        $this->withToken($w['session'])->postJson(self::BASE, $this->payload(['fuel_tanker_id' => $this->tanker->id]))->assertCreated();
    }

    // ───────────────────────── القراءات المساندة ─────────────────────────

    /** @test */
    public function owners_and_tankers_lists_hide_phone_and_notes_from_a_station_worker(): void
    {
        $w = $this->worker($this->recorder());
        $owners = $this->withToken($w['session'])->getJson('/api/fuel-stations/tanker-owners')->assertOk();
        $this->assertSame($this->owner->id, $owners->json('data.0.id'));
        $this->assertArrayNotHasKey('phone', $owners->json('data.0'));
        $this->assertArrayNotHasKey('notes', $owners->json('data.0'));
        $tankers = $this->withToken($w['session'])->getJson("/api/fuel-stations/tankers?owner_id={$this->owner->id}&status=active")->assertOk();
        $this->assertSame($this->tanker->id, $tankers->json('data.0.id'));
        $this->assertArrayNotHasKey('notes', $tankers->json('data.0'));
        $this->assertArrayNotHasKey('tenant_id', $tankers->json('data.0'));
    }

    // ───────────────────────── الحجب ─────────────────────────

    /** @test */
    public function a_pin_session_of_an_owner_or_admin_cannot_reach_any_posting_reversal_void_attachment_report_or_settings_route(): void
    {
        $admin = $this->attachEmployee(User::query()->where('role', 'owner')->firstOrFail());
        $fill = $this->withToken($this->fx['owner'])->postJson(self::BASE, $this->payload())->assertCreated()->json('data.id');
        $uuid = '00000000-0000-4000-8000-0000000000ff';
        config(['fuel_stations.tanker_inventory_posting_enabled' => true]); // حتى لو فُتحت بوابة الترحيل، يمنع الحدّ الجلسة
        $before = $this->footprint();

        foreach ([
            ['POST', self::BASE . "/{$fill}/void", ['reason' => 'اختبار']],
            ['POST', self::BASE . "/{$fill}/inventory-posting", ['reason' => 'اختبار']], ['GET', self::BASE . "/{$fill}/inventory-posting/preview", null],
            ['POST', self::BASE . "/{$fill}/inventory-reversal", ['reason' => 'اختبار']], ['GET', self::BASE . "/{$fill}/inventory-reversal/preview", null],
            ['GET', self::BASE . '/inventory-review', null], ['GET', self::BASE . '/inventory-review/reconciliation', null], ['GET', self::BASE . '/inventory-settings', null],
            ['GET', self::BASE . '/inventory-workspace', null], ['GET', self::BASE . "/{$fill}/inventory", null],
            ['GET', '/api/fuel-stations/tanker-fill-reports/fills', null], ['GET', '/api/fuel-stations/tanker-fill-reports/clearing-account', null], ['GET', '/api/fuel-stations/tanker-fill-reports/accounting-control', null],
            ['GET', self::BASE . "/{$fill}/attachments", null], ['POST', self::BASE . "/{$fill}/attachments", []], ['GET', self::BASE . "/{$fill}/attachments/{$uuid}/download", null],
            ['POST', self::BASE . "/{$fill}/attachments/{$uuid}/replace", []], ['DELETE', self::BASE . "/{$fill}/attachments/{$uuid}", ['reason' => 'اختبار']],
            ['GET', "/api/fuel-stations/tanker-owners/{$this->owner->id}", null], ['GET', "/api/fuel-stations/tanker-owners/{$this->owner->id}/company-links", null],
            ['POST', '/api/fuel-stations/tanker-owners', ['name' => 'جديد']], ['PUT', "/api/fuel-stations/tankers/{$this->tanker->id}", ['status' => 'inactive']],
            ['GET', '/api/fuel-stations/settings', null], ['PUT', "/api/fuel-stations/stations/{$this->fx['s1']->id}/settings", ['tanker_selection_required' => true, 'reason' => 'x']],
            ['GET', '/api/accounts', null], ['GET', '/api/reports/trial-balance', null],
        ] as [$method, $url, $body]) {
            $response = $this->withToken($admin['session'])->json($method, $url, $body ?? []);
            $this->assertSame(403, $response->status(), "{$method} {$url} must be 403 for a PIN session, got {$response->status()}");
        }
        $this->assertSame($before, $this->footprint(), 'لا أثر مخزني ولا محاسبي');
        $this->assertSame('recorded', FuelTankerFill::query()->findOrFail($fill)->status);
        $this->assertSame('pending_integration', FuelTankerFill::query()->findOrFail($fill)->inventory_status);
    }

    /** @test */
    public function rbac_still_applies_inside_the_whitelist(): void
    {
        $seller = $this->worker(FuelStaffTemplates::permissions(FuelStaffTemplates::SELLER) ?? []); // القالب الحالي بلا صلاحيات تعبئة
        $this->withToken($seller['session'])->postJson(self::BASE, $this->payload())->assertForbidden();
        $this->withToken($seller['session'])->getJson(self::BASE)->assertForbidden();
        $this->withToken($seller['session'])->getJson('/api/fuel-stations/tanker-owners')->assertForbidden();
        $this->assertSame(0, FuelTankerFill::query()->count());

        $viewOnly = $this->worker(['fuel.tanker.fill.view']);
        $this->withToken($viewOnly['session'])->getJson(self::BASE)->assertOk();
        $this->withToken($viewOnly['session'])->postJson(self::BASE, $this->payload())->assertForbidden();
    }

    /** @test */
    public function the_two_deployment_gates_close_the_whole_station_flow_with_a_uniform_404(): void
    {
        $w = $this->worker($this->recorder());
        foreach ([['fuel_stations.tanker_fills_enabled' => false], ['fuel_stations.tanker_management_enabled' => false]] as $closed) {
            config($closed);
            $this->withToken($w['session'])->postJson(self::BASE, $this->payload())->assertNotFound();
            $this->withToken($w['session'])->getJson(self::BASE)->assertNotFound();
            // قائمة الأصحاب خلف بوابة الإدارة وحدها: تُغلق بإغلاقها لا بإغلاق بوابة السندات.
            $this->withToken($w['session'])->getJson('/api/fuel-stations/tanker-owners')->assertStatus(array_key_exists('fuel_stations.tanker_management_enabled', $closed) ? 404 : 200);
            config(['fuel_stations.tanker_fills_enabled' => true, 'fuel_stations.tanker_management_enabled' => true]);
        }
        $this->assertSame(0, FuelTankerFill::query()->count());
    }

    /** @test */
    public function the_gates_default_to_closed_in_the_shipped_configuration(): void
    {
        $config = file_get_contents(base_path('config/fuel_stations.php'));
        $this->assertMatchesRegularExpression("/'tanker_fills_enabled'\\s*=>\\s*\\(bool\\)\\s*env\\('FUEL_TANKER_FILLS_ENABLED',\\s*false\\)/", $config);
        $this->assertMatchesRegularExpression("/'tanker_inventory_posting_enabled'\\s*=>\\s*\\(bool\\)\\s*env\\('FUEL_TANKER_INVENTORY_POSTING_ENABLED',\\s*false\\)/", $config);
    }

    // ───────────────────────── العزل ─────────────────────────

    /** @test */
    public function station_branch_and_tenant_isolation_hold_for_a_pin_session(): void
    {
        $w = $this->worker($this->recorder(), [$this->fx['s1']->id]);

        // محطة أخرى في الفرع نفسه (خارج إسناد الموظف) ⇒ 404 موحَّد، ولا سند.
        $pump2 = FuelPump::create(['branch_id' => $this->fx['branchA']->id, 'fuel_station_id' => $this->fx['s2']->id, 'pump_number' => '01', 'name' => 'م']);
        $n2 = $this->nozzle($this->fx['s2'], $pump2, $this->fx['t2'], '1');
        $this->openShift($this->fx['s2'], 'FSH-P7-3');
        $this->withToken($w['session'])->postJson(self::BASE, $this->payload(['fuel_station_id' => $this->fx['s2']->id, 'fuel_nozzle_id' => $n2->id, 'fuel_shift_id' => null]))->assertNotFound();
        // فوهة محطة أخرى مع محطة الموظف ⇒ مرفوضة.
        $this->withToken($w['session'])->postJson(self::BASE, $this->payload(['fuel_nozzle_id' => $n2->id]))->assertStatus(422);
        $this->assertSame(0, FuelTankerFill::query()->count());

        // سند محطة أخرى لا يظهر في قائمة الموظف ولا يُقرأ.
        $other = $this->worker($this->recorder(), [$this->fx['s2']->id]);
        $foreign = $this->withToken($other['session'])->postJson(self::BASE, $this->payload(['fuel_station_id' => $this->fx['s2']->id, 'fuel_nozzle_id' => $n2->id, 'fuel_shift_id' => null, 'voucher_number' => '7001']))->assertCreated()->json('data.id');
        $this->assertSame([], $this->withToken($w['session'])->getJson(self::BASE)->assertOk()->json('data'));
        $this->withToken($w['session'])->getJson(self::BASE . "/{$foreign}")->assertNotFound();

        // فرع آخر: موظف مقيَّد بفرع ب لا يرى ولا يسجّل على محطة فرع أ.
        $b = $this->worker($this->recorder(), null);
        $b['user']->branches()->sync([$this->fx['branchB']->id]);
        $this->withToken($b['session'])->postJson(self::BASE, $this->payload())->assertStatus(404);
        $this->assertSame([], $this->withToken($b['session'])->getJson(self::BASE)->assertOk()->json('data'));
    }

    /** @test */
    public function another_tenants_session_cannot_read_or_record_against_this_tenants_data(): void
    {
        $fill = $this->withToken($this->worker($this->recorder())['session'])->postJson(self::BASE, $this->payload())->assertCreated()->json('data.id');
        $this->assertNotEmpty($fill);

        $auth = $this->registerTenant('fuel-p7-other', 'owner@fuel-p7-other.test', autoEnableApplications: true);
        $otherTenant = User::query()->withoutGlobalScopes()->where('email', 'owner@fuel-p7-other.test')->firstOrFail();
        $session = $otherTenant->createToken(StationSessionBoundary::TOKEN_NAME, [StationSessionBoundary::ABILITY])->plainTextToken;
        // مستأجر آخر بلا موظف مرتبط ⇒ الحدّ نفسه يرفض (فشل مغلق).
        $this->withToken($session)->getJson(self::BASE . "/{$fill}")->assertForbidden();
        $this->assertContains($this->withToken($auth['token'])->getJson(self::BASE . "/{$fill}")->status(), [403, 404], 'مستأجر آخر لا يقرأ السند أبداً');
        $this->assertSame(1, FuelTankerFill::query()->withoutGlobalScopes()->count());
    }

    // ───────────────────────── تبديل الموظف والجلسة ─────────────────────────

    /** @test */
    public function logging_out_revokes_the_session_and_a_second_employee_gets_their_own_attribution(): void
    {
        $a = $this->worker($this->recorder());
        $b = $this->worker($this->recorder());
        $idA = $this->withToken($a['session'])->postJson(self::BASE, $this->payload())->assertCreated()->json('data.id');

        $this->withToken($a['session'])->postJson('/api/logout')->assertOk();
        $this->app['auth']->forgetGuards();
        $this->withToken($a['session'])->getJson(self::BASE)->assertUnauthorized();

        $idB = $this->withToken($b['session'])->postJson(self::BASE, $this->payload(['voucher_number' => '5002']))->assertCreated()->json('data.id');
        $this->assertSame($a['user']->id, FuelTankerFill::query()->findOrFail($idA)->recorded_by);
        $this->assertSame($b['user']->id, FuelTankerFill::query()->findOrFail($idB)->recorded_by);
        $this->assertNotSame($a['user']->id, $b['user']->id);
    }

    /** @test */
    public function an_employee_deactivated_after_login_loses_the_session_on_the_next_request(): void
    {
        $w = $this->worker($this->recorder());
        $this->withToken($w['session'])->getJson(self::BASE)->assertOk();
        Employee::query()->whereKey($w['employee']->id)->update(['is_active' => false]);
        $this->withToken($w['session'])->getJson(self::BASE)->assertForbidden();
        $this->withToken($w['session'])->postJson(self::BASE, $this->payload())->assertForbidden();
        $this->assertSame(0, FuelTankerFill::query()->count());
    }

    /** @test */
    public function a_real_pin_login_session_records_a_fill_end_to_end(): void
    {
        $w = $this->worker($this->recorder());
        $login = $this->postJson(self::HOST . 'station/login', ['employee_no' => $w['employee']->employee_no, 'pin' => self::PIN])->assertOk();
        $token = $login->json('token');
        $this->assertNotEmpty($token);

        $this->withToken($token)->postJson(self::BASE, $this->payload())->assertCreated()->assertJsonPath('data.inventory_status', 'pending_integration');
        $this->withToken($token)->postJson(self::BASE . '/' . FuelTankerFill::query()->firstOrFail()->id . '/void', ['reason' => 'اختبار'])->assertForbidden();
    }
}
