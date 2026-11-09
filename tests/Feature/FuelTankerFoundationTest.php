<?php

namespace Tests\Feature;

use App\Models\FuelStationAuditEvent;
use App\Models\FuelTanker;
use App\Models\FuelTankerOwner;
use App\Models\FuelTankerOwnerCompanyLink;
use App\Models\Partner;
use App\Models\Role;
use App\Models\Tenant;
use App\Models\User;
use App\Services\EntitlementGrantService;
use App\Services\FuelTankerService;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use App\Support\FuelStaffTemplates;
use App\Support\Rbac;
use App\Support\StationSessionBoundary;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * TANKER-PR1 — أساس إدارة أصحاب الصهاريج (بيانات رئيسية فقط، خلف بوابة مغلقة افتراضياً):
 *  - البوابة مغلقة ⇒ 404 موحَّد لكل المسارات حتى للمالك؛ مفتوحة ⇒ تعمل بالصلاحيات.
 *  - مفتاحا `fuel.tanker.view|manage` لا يُمنحان ضمنياً (لا دور مدمج ولا قالب موظف).
 *  - عزل المستأجر بالمعرّف المباشر، وتدقيق بالفاعل، وربط الشركات مؤرَّخاً بلا تداخل ولا إعادة فتح.
 *  - **لا أثر مالي أو مخزني إطلاقاً** (لا قيد ولا مخزون ولا فاتورة ولا قبض) ولا وصول لجلسة PIN.
 */
class FuelTankerFoundationTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const BASE = '/api/fuel-stations';
    private const UNKNOWN = '00000000-0000-4000-8000-000000000001';

    private string $tenantId;
    private string $owner;

    // ───────────────────────── البوابة والصلاحيات ─────────────────────────

    /** @test */
    public function the_gate_is_closed_by_default_and_every_route_answers_a_uniform_404_even_for_the_owner(): void
    {
        $this->assertFalse((bool) config('fuel_stations.tanker_management_enabled'));
        $this->fixture(gateOpen: false);

        $calls = [
            ['GET', '/tanker-owners'], ['POST', '/tanker-owners'], ['GET', '/tanker-owners/' . self::UNKNOWN], ['PUT', '/tanker-owners/' . self::UNKNOWN],
            ['GET', '/tanker-owners/' . self::UNKNOWN . '/company-links'], ['POST', '/tanker-owners/' . self::UNKNOWN . '/company-links'],
            ['POST', '/tanker-owners/' . self::UNKNOWN . '/company-links/' . self::UNKNOWN . '/end'],
            ['GET', '/tankers'], ['POST', '/tankers'], ['GET', '/tankers/' . self::UNKNOWN], ['PUT', '/tankers/' . self::UNKNOWN],
        ];
        $bodies = [];
        foreach ($calls as [$verb, $path]) {
            $response = $this->withToken($this->owner)->json($verb, self::BASE . $path, ['name' => 'x', 'plate_number' => 'x']);
            $response->assertNotFound();
            $bodies[] = $response->getContent();
        }
        $this->assertCount(1, array_unique($bodies), 'closed gate must answer one identical body');
        $this->assertSame(0, FuelTankerOwner::count() + FuelTanker::count());
    }

    /** @test */
    public function the_gate_is_checked_before_permissions_so_a_user_without_the_key_cannot_probe_the_feature(): void
    {
        $this->fixture(gateOpen: false);
        $none = $this->tokenWithPermissions([]);

        $this->withToken($none)->getJson(self::BASE . '/tanker-owners')->assertNotFound();
        config(['fuel_stations.tanker_management_enabled' => true]);
        $this->withToken($none)->getJson(self::BASE . '/tanker-owners')->assertForbidden();
    }

    /** @test */
    public function the_keys_exist_but_are_never_granted_implicitly(): void
    {
        foreach (['fuel.tanker.view', 'fuel.tanker.manage'] as $key) {
            $this->assertContains($key, Rbac::PERMISSIONS);
            $this->assertTrue(Rbac::allows('owner', $key));
            $this->assertTrue(Rbac::allows('admin', $key));
            foreach (['accountant', 'staff', 'self_service'] as $role) {
                $this->assertFalse(Rbac::allows($role, $key), "{$role} must not receive {$key}");
            }
            $this->assertArrayNotHasKey($key, array_flip(array_merge(...array_values(Rbac::MATRIX))), "{$key} must not be in MATRIX");
            foreach ([FuelStaffTemplates::SELLER, FuelStaffTemplates::SUPERVISOR, FuelStaffTemplates::STATION_MANAGER] as $template) {
                $this->assertNotContains($key, FuelStaffTemplates::permissions($template) ?? [], "{$key} must not be in template {$template}");
            }
        }
    }

    /** @test */
    public function view_and_manage_are_separate_and_a_legacy_station_manager_cannot_use_the_feature(): void
    {
        $this->fixture();
        $viewer = $this->tokenWithPermissions(['fuel.tanker.view']);
        $manager = $this->tokenWithPermissions(['fuel.tanker.view', 'fuel.tanker.manage']);
        $legacy = $this->tokenWithPermissions(['fuel_stations.view', 'fuel_stations.manage']);

        $ownerId = $this->withToken($manager)->postJson(self::BASE . '/tanker-owners', ['name' => 'عسكر', 'phone' => '0500000000', 'notes' => 'سري داخلي'])->assertCreated()->json('data.id');

        $this->withToken($viewer)->getJson(self::BASE . '/tanker-owners')->assertOk();
        $this->withToken($viewer)->postJson(self::BASE . '/tanker-owners', ['name' => 'x'])->assertForbidden();
        $this->withToken($viewer)->putJson(self::BASE . "/tanker-owners/{$ownerId}", ['name' => 'y'])->assertForbidden();
        $this->withToken($viewer)->postJson(self::BASE . '/tankers', ['fuel_tanker_owner_id' => $ownerId, 'plate_number' => 'A'])->assertForbidden();
        $this->withToken($viewer)->postJson(self::BASE . "/tanker-owners/{$ownerId}/company-links", ['partner_id' => self::UNKNOWN])->assertForbidden();
        $this->withToken($legacy)->getJson(self::BASE . '/tanker-owners')->assertForbidden();
        $this->withToken($legacy)->postJson(self::BASE . '/tanker-owners', ['name' => 'x'])->assertForbidden();

        // الهاتف والملاحظات للمدير وحده.
        $seen = $this->withToken($viewer)->getJson(self::BASE . "/tanker-owners/{$ownerId}")->assertOk()->json('data');
        $this->assertArrayNotHasKey('phone', $seen);
        $this->assertArrayNotHasKey('notes', $seen);
        $this->assertArrayNotHasKey('tenant_id', $seen);
        $full = $this->withToken($manager)->getJson(self::BASE . "/tanker-owners/{$ownerId}")->assertOk()->json('data');
        $this->assertSame('0500000000', $full['phone']);
    }

    /** @test */
    public function a_tenant_without_the_fuel_application_is_refused_even_with_the_gate_open_and_the_key(): void
    {
        $auth = $this->registerTenant('tanker-noapp', 'owner@tanker-noapp.test', autoEnableApplications: false);
        config(['fuel_stations.tanker_management_enabled' => true]);

        $status = $this->withToken($auth['token'])->getJson(self::BASE . '/tanker-owners')->getStatusCode();
        $this->assertContains($status, [402, 403, 404], "entitlement must be enforced, got {$status}");
    }

    // ───────────────────────── أصحاب الصهاريج ─────────────────────────

    /** @test */
    public function an_owner_profile_is_created_updated_and_audited_with_the_actor(): void
    {
        $this->fixture();

        $created = $this->withToken($this->owner)->postJson(self::BASE . '/tanker-owners', ['name' => '  عسكر  ', 'code' => 'TO-1', 'phone' => '0500000000', 'reason' => 'تعريف'])->assertCreated()->json('data');
        $this->assertSame('عسكر', $created['name']);
        $this->assertSame('active', $created['status']);

        $this->withToken($this->owner)->putJson(self::BASE . "/tanker-owners/{$created['id']}", ['status' => 'suspended', 'reason' => 'إيقاف مؤقت'])->assertOk()->assertJsonPath('data.status', 'suspended');

        $events = FuelStationAuditEvent::query()->where('subject_id', $created['id'])->orderBy('occurred_at')->orderBy('id')->get();
        $this->assertEqualsCanonicalizing(['tanker_owner.created', 'tanker_owner.updated'], $events->pluck('action')->all());
        $updated = $events->firstWhere('action', 'tanker_owner.updated');
        $this->assertNotNull($updated->actor_id);
        $this->assertSame(['status' => 'active'], array_intersect_key($updated->before, ['status' => 1]));
        $this->assertSame(['status' => 'suspended'], array_intersect_key($updated->after, ['status' => 1]));
        $this->assertSame('إيقاف مؤقت', $updated->reason);
        $this->assertSame(FuelTankerOwner::class, $updated->subject_type);

        // طلب بلا تغيير فعلي لا يكتب حدثاً.
        $count = FuelStationAuditEvent::count();
        $this->withToken($this->owner)->putJson(self::BASE . "/tanker-owners/{$created['id']}", ['status' => 'suspended'])->assertOk();
        $this->assertSame($count, FuelStationAuditEvent::count());
    }

    /** @test */
    public function owner_validation_rejects_duplicates_bad_status_and_unknown_fields_are_ignored(): void
    {
        $this->fixture();
        $this->withToken($this->owner)->postJson(self::BASE . '/tanker-owners', ['name' => 'أ', 'code' => 'C1'])->assertCreated();

        $this->withToken($this->owner)->postJson(self::BASE . '/tanker-owners', ['name' => 'ب', 'code' => 'C1'])->assertStatus(422)->assertJsonValidationErrors('code');
        $this->withToken($this->owner)->postJson(self::BASE . '/tanker-owners', ['name' => ''])->assertStatus(422)->assertJsonValidationErrors('name');
        $this->withToken($this->owner)->postJson(self::BASE . '/tanker-owners', ['name' => 'ج', 'status' => 'deleted'])->assertStatus(422);

        // tenant_id/partner_id المرسلة لا تُكتب أبداً.
        $other = (string) \Illuminate\Support\Str::uuid();
        $id = $this->withToken($this->owner)->postJson(self::BASE . '/tanker-owners', ['name' => 'د', 'tenant_id' => $other, 'partner_id' => $other])->assertCreated()->json('data.id');
        $row = FuelTankerOwner::findOrFail($id);
        $this->assertSame($this->tenantId, $row->tenant_id);
        $this->assertNull($row->partner_id);

        // الأكواد الفارغة المتعددة مسموحة (NULL).
        $this->withToken($this->owner)->postJson(self::BASE . '/tanker-owners', ['name' => 'هـ'])->assertCreated();
        $this->withToken($this->owner)->postJson(self::BASE . '/tanker-owners', ['name' => 'و'])->assertCreated();
    }

    /** @test */
    public function the_owner_list_filters_by_status_and_search_and_never_deletes(): void
    {
        $this->fixture();
        $a = $this->withToken($this->owner)->postJson(self::BASE . '/tanker-owners', ['name' => 'عسكر', 'code' => 'AS'])->assertCreated()->json('data.id');
        $this->withToken($this->owner)->postJson(self::BASE . '/tanker-owners', ['name' => 'عزوز', 'status' => 'inactive'])->assertCreated();

        $this->assertCount(2, $this->withToken($this->owner)->getJson(self::BASE . '/tanker-owners')->json('data'));
        $this->assertCount(1, $this->withToken($this->owner)->getJson(self::BASE . '/tanker-owners?status=inactive')->json('data'));
        $this->assertSame($a, $this->withToken($this->owner)->getJson(self::BASE . '/tanker-owners?q=AS')->json('data.0.id'));
        $this->assertCount(0, $this->withToken($this->owner)->getJson(self::BASE . '/tanker-owners?q=%25')->json('data'), 'LIKE wildcards are escaped');

        $this->withToken($this->owner)->deleteJson(self::BASE . "/tanker-owners/{$a}")->assertStatus(405);
        $this->expectException(\LogicException::class);
        FuelTankerOwner::findOrFail($a)->delete();
    }

    // ───────────────────────── الصهاريج ─────────────────────────

    /** @test */
    public function a_tanker_belongs_to_an_active_owner_and_plates_are_unique_after_normalisation(): void
    {
        $this->fixture();
        $ownerId = $this->makeOwner('عسكر');

        $tanker = $this->withToken($this->owner)->postJson(self::BASE . '/tankers', [
            'fuel_tanker_owner_id' => $ownerId, 'plate_number' => 'أ ب ج 1234', 'capacity_milliliters' => 30000000,
        ])->assertCreated()->json('data');
        $this->assertSame('أ ب ج 1234', $tanker['plate_number']);
        $this->assertSame(30000000, $tanker['capacity_milliliters']);
        $this->assertSame($ownerId, $tanker['fuel_tanker_owner_id']);
        $this->assertArrayNotHasKey('plate_key', $tanker);

        // نفس اللوحة بأرقام عربية ومسافات/شرطات مختلفة = تكرار.
        $this->withToken($this->owner)->postJson(self::BASE . '/tankers', ['fuel_tanker_owner_id' => $ownerId, 'plate_number' => 'أبج-١٢٣٤'])
            ->assertStatus(422)->assertJsonValidationErrors('plate_number');
        $this->assertSame('ABC1234', FuelTankerService::plateKey(' abc-12 34 '));
        $this->assertSame('1234', FuelTankerService::plateKey('١٢٣٤'));

        // سعة غير صالحة.
        $this->withToken($this->owner)->postJson(self::BASE . '/tankers', ['fuel_tanker_owner_id' => $ownerId, 'plate_number' => 'Z1', 'capacity_milliliters' => 0])->assertStatus(422);
        $this->withToken($this->owner)->postJson(self::BASE . '/tankers', ['fuel_tanker_owner_id' => $ownerId, 'plate_number' => 'Z2', 'capacity_milliliters' => 1.5])->assertStatus(422);

        // صاحب صهريج غير نشط أو مجهول.
        $this->withToken($this->owner)->putJson(self::BASE . "/tanker-owners/{$ownerId}", ['status' => 'inactive'])->assertOk();
        $this->withToken($this->owner)->postJson(self::BASE . '/tankers', ['fuel_tanker_owner_id' => $ownerId, 'plate_number' => 'Z3'])->assertStatus(422);
        $this->withToken($this->owner)->postJson(self::BASE . '/tankers', ['fuel_tanker_owner_id' => self::UNKNOWN, 'plate_number' => 'Z4'])->assertStatus(422)->assertJsonValidationErrors('fuel_tanker_owner_id');
    }

    /** @test */
    public function a_tanker_cannot_move_to_another_owner_and_updates_are_audited(): void
    {
        $this->fixture();
        $a = $this->makeOwner('أ');
        $b = $this->makeOwner('ب');
        $id = $this->withToken($this->owner)->postJson(self::BASE . '/tankers', ['fuel_tanker_owner_id' => $a, 'plate_number' => 'T-1'])->assertCreated()->json('data.id');

        // إرسال المالك نفسه مقبول (لا تغيير)، وآخر مرفوض بلا أي كتابة.
        $this->withToken($this->owner)->putJson(self::BASE . "/tankers/{$id}", ['fuel_tanker_owner_id' => $a, 'status' => 'suspended', 'reason' => 'صيانة'])->assertOk()->assertJsonPath('data.status', 'suspended');
        $this->withToken($this->owner)->putJson(self::BASE . "/tankers/{$id}", ['fuel_tanker_owner_id' => $b])->assertStatus(422);
        $this->assertSame($a, FuelTanker::findOrFail($id)->fuel_tanker_owner_id);

        $event = FuelStationAuditEvent::query()->where('subject_id', $id)->where('action', 'tanker.updated')->firstOrFail();
        $this->assertSame('suspended', $event->after['status']);

        $list = $this->withToken($this->owner)->getJson(self::BASE . "/tankers?owner_id={$a}")->assertOk()->json('data');
        $this->assertCount(1, $list);
        $this->assertSame('أ', $list[0]['owner']['name']);
        $this->assertCount(0, $this->withToken($this->owner)->getJson(self::BASE . "/tankers?owner_id={$b}")->json('data'));
    }

    // ───────────────────────── ربط الشركات ─────────────────────────

    /** @test */
    public function a_company_link_is_dated_validated_and_never_overlaps_for_the_same_pair(): void
    {
        $this->fixture();
        $ownerId = $this->makeOwner('عسكر');
        $company = $this->makePartner('كيفير', 'customer');

        $link = $this->withToken($this->owner)->postJson(self::BASE . "/tanker-owners/{$ownerId}/company-links", ['partner_id' => $company->id, 'valid_from' => '2026-01-01', 'note' => 'عقد'])
            ->assertCreated()->json('data');
        $this->assertSame('2026-01-01', $link['valid_from']);
        $this->assertNull($link['valid_to']);
        $this->assertTrue($link['is_active']);
        $this->assertSame('كيفير', $link['partner']['name']);

        // تداخل (مفتوح النهاية) مرفوض.
        $this->withToken($this->owner)->postJson(self::BASE . "/tanker-owners/{$ownerId}/company-links", ['partner_id' => $company->id, 'valid_from' => '2026-06-01'])
            ->assertStatus(422)->assertJsonValidationErrors('partner_id');
        // نهاية قبل البداية مرفوضة.
        $this->withToken($this->owner)->postJson(self::BASE . "/tanker-owners/{$ownerId}/company-links", ['partner_id' => $this->makePartner('أخرى', 'customer')->id, 'valid_from' => '2026-06-01', 'valid_to' => '2026-05-01'])
            ->assertStatus(422)->assertJsonValidationErrors('valid_to');

        // إنهاء الربط بتاريخ، ثم ربط جديد بعد النهاية مسموح، وقبلها مرفوض.
        $ended = $this->withToken($this->owner)->postJson(self::BASE . "/tanker-owners/{$ownerId}/company-links/{$link['id']}/end", ['valid_to' => '2026-03-31', 'reason' => 'إنهاء العقد'])->assertOk()->json('data');
        $this->assertSame('2026-03-31', $ended['valid_to']);
        $this->assertFalse($ended['is_active']);
        $this->withToken($this->owner)->postJson(self::BASE . "/tanker-owners/{$ownerId}/company-links", ['partner_id' => $company->id, 'valid_from' => '2026-03-31'])->assertStatus(422);
        $this->withToken($this->owner)->postJson(self::BASE . "/tanker-owners/{$ownerId}/company-links", ['partner_id' => $company->id, 'valid_from' => '2026-04-01'])->assertCreated();

        // لا إنهاء ثانٍ لربط منتهٍ، ولا إنهاء قبل البداية.
        $this->withToken($this->owner)->postJson(self::BASE . "/tanker-owners/{$ownerId}/company-links/{$link['id']}/end", ['valid_to' => '2026-04-30'])->assertStatus(422);
        $open = FuelTankerOwnerCompanyLink::query()->whereNull('valid_to')->firstOrFail();
        $this->withToken($this->owner)->postJson(self::BASE . "/tanker-owners/{$ownerId}/company-links/{$open->id}/end", ['valid_to' => '2026-03-01'])->assertStatus(422)->assertJsonValidationErrors('valid_to');

        // التاريخ محفوظ ومدقَّق.
        $this->assertCount(2, $this->withToken($this->owner)->getJson(self::BASE . "/tanker-owners/{$ownerId}/company-links")->json('data'));
        $this->assertSame(
            ['tanker_owner_link.created', 'tanker_owner_link.ended'],
            FuelStationAuditEvent::query()->where('subject_id', $link['id'])->orderBy('action')->pluck('action')->all(),
        );
    }

    /** @test */
    public function only_active_non_system_customers_of_this_tenant_can_be_linked(): void
    {
        $this->fixture();
        $ownerId = $this->makeOwner('عسكر');
        $url = self::BASE . "/tanker-owners/{$ownerId}/company-links";

        $supplier = $this->makePartner('مورد', 'supplier');
        $both = $this->makePartner('طرفان', 'both');
        $inactive = $this->makePartner('معطل', 'customer', active: false);
        $system = $this->makePartner('نظامي', 'customer');
        DB::table('partners')->where('id', $system->id)->update(['system_kind' => 'fuel_walk_in']);

        foreach ([$supplier, $inactive, $system] as $bad) {
            $this->withToken($this->owner)->postJson($url, ['partner_id' => $bad->id])->assertStatus(422)->assertJsonValidationErrors('partner_id');
        }
        $this->withToken($this->owner)->postJson($url, ['partner_id' => self::UNKNOWN])->assertStatus(422)->assertJsonValidationErrors('partner_id');
        $this->withToken($this->owner)->postJson($url, ['partner_id' => $both->id])->assertCreated();

        // الربط بصاحب صهريج معطَّل مرفوض، ولا يعدّل أي بيان للعميل.
        $this->withToken($this->owner)->putJson(self::BASE . "/tanker-owners/{$ownerId}", ['status' => 'inactive'])->assertOk();
        $this->withToken($this->owner)->postJson($url, ['partner_id' => $this->makePartner('جديد', 'customer')->id])->assertStatus(422);
        $this->assertSame('both', $both->fresh()->type);
        $this->assertSame('طرفان', $both->fresh()->name);
    }

    /** @test */
    public function link_rows_are_frozen_in_the_model_and_cannot_be_reopened_or_deleted(): void
    {
        $this->fixture();
        $ownerId = $this->makeOwner('عسكر');
        $company = $this->makePartner('كيفير', 'customer');
        $id = $this->withToken($this->owner)->postJson(self::BASE . "/tanker-owners/{$ownerId}/company-links", ['partner_id' => $company->id, 'valid_from' => '2026-01-01'])->assertCreated()->json('data.id');
        $this->withToken($this->owner)->postJson(self::BASE . "/tanker-owners/{$ownerId}/company-links/{$id}/end", ['valid_to' => '2026-02-01'])->assertOk();

        $link = FuelTankerOwnerCompanyLink::findOrFail($id);
        foreach ([
            fn () => $link->update(['partner_id' => $this->makePartner('x', 'customer')->id]),
            fn () => $link->update(['valid_from' => '2025-01-01']),
            fn () => $link->update(['valid_to' => '2026-12-31']),
            fn () => $link->update(['valid_to' => null]),
            fn () => $link->delete(),
        ] as $mutation) {
            $thrown = null;
            try {
                $mutation();
            } catch (\LogicException $e) {
                $thrown = $e;
            }
            $this->assertNotNull($thrown, 'frozen link mutation must throw');
        }
        $this->assertSame('2026-02-01', FuelTankerOwnerCompanyLink::findOrFail($id)->valid_to->toDateString());
    }

    /** @test */
    public function the_shared_audit_reader_never_exposes_tanker_snapshots_without_the_tanker_manage_key_and_an_open_gate(): void
    {
        $this->fixture();
        $ownerId = $this->withToken($this->owner)->postJson(self::BASE . '/tanker-owners', ['name' => 'عسكر', 'phone' => '0555555555', 'notes' => 'ملاحظة سرية'])->assertCreated()->json('data.id');
        $this->withToken($this->owner)->postJson(self::BASE . '/tankers', ['fuel_tanker_owner_id' => $ownerId, 'plate_number' => 'AUD-1'])->assertCreated();
        $company = $this->makePartner('كيفير', 'customer');
        $this->withToken($this->owner)->postJson(self::BASE . "/tanker-owners/{$ownerId}/company-links", ['partner_id' => $company->id])->assertCreated();

        $subjects = fn (string $token, string $query = '') => collect($this->withToken($token)->getJson(self::BASE . '/audit-events' . $query)->assertOk()->json('data'))->pluck('subject_type')->unique()->values()->all();
        $tanker = ['FuelTankerOwner', 'FuelTanker', 'FuelTankerOwnerCompanyLink'];

        // المفتاح القديم وحده (نطاق غير مقيَّد): لا أي حدث صهاريج، لا بقائمة عامة ولا بالتصفية بالنوع ولا بالمعرّف.
        $legacy = $this->tokenWithPermissions(['fuel_stations.view', 'fuel_stations.manage']);
        $this->assertSame([], array_intersect($tanker, $subjects($legacy)));
        $this->assertSame([], $subjects($legacy, '?subject_type=FuelTankerOwner'));
        $this->assertSame([], $subjects($legacy, "?subject_id={$ownerId}"));
        $raw = $this->withToken($legacy)->getJson(self::BASE . '/audit-events?per_page=100')->assertOk()->getContent();
        $this->assertStringNotContainsString('0555555555', $raw);
        $this->assertStringNotContainsString('ملاحظة سرية', $raw);

        // عرض الصهاريج وحده (دون إدارة) لا يكفي أيضاً.
        $viewer = $this->tokenWithPermissions(['fuel_stations.view', 'fuel_stations.manage', 'fuel.tanker.view']);
        $this->assertSame([], array_intersect($tanker, $subjects($viewer)));

        // المدير مع بوابة مفتوحة يراها كلها.
        $manager = $this->tokenWithPermissions(['fuel_stations.view', 'fuel_stations.manage', 'fuel.tanker.manage']);
        $this->assertEqualsCanonicalizing($tanker, array_intersect($tanker, $subjects($manager)));
        $this->assertSame(['FuelTankerOwner'], $subjects($manager, '?subject_type=FuelTankerOwner'));

        // البوابة مغلقة: حتى المالك والمدير لا يرون ما كُتب سابقاً.
        config(['fuel_stations.tanker_management_enabled' => false]);
        $this->assertSame([], array_intersect($tanker, $subjects($manager)));
        $this->assertSame([], array_intersect($tanker, $subjects($this->owner)));
    }

    // ───────────────────────── العزل ─────────────────────────

    /** @test */
    public function another_tenant_cannot_read_write_or_link_this_tenants_records_by_direct_id(): void
    {
        $this->fixture();
        $ownerId = $this->makeOwner('عسكر');
        $tankerId = $this->withToken($this->owner)->postJson(self::BASE . '/tankers', ['fuel_tanker_owner_id' => $ownerId, 'plate_number' => 'ISO-1'])->assertCreated()->json('data.id');
        $company = $this->makePartner('كيفير', 'customer');
        $linkId = $this->withToken($this->owner)->postJson(self::BASE . "/tanker-owners/{$ownerId}/company-links", ['partner_id' => $company->id])->assertCreated()->json('data.id');

        $other = $this->registerTenant('globex-tanker', 'owner@globex-tanker.test', autoEnableApplications: true);
        $this->grantFuel($other['tenant_id'], 'test_tanker_other');
        $foreign = $other['token'];
        $foreignOwner = $this->withToken($foreign)->postJson(self::BASE . '/tanker-owners', ['name' => 'غريب', 'code' => 'AS'])->assertCreated()->json('data.id');

        $this->withToken($foreign)->getJson(self::BASE . "/tanker-owners/{$ownerId}")->assertNotFound();
        $this->withToken($foreign)->putJson(self::BASE . "/tanker-owners/{$ownerId}", ['name' => 'سطو'])->assertNotFound();
        $this->withToken($foreign)->getJson(self::BASE . "/tankers/{$tankerId}")->assertNotFound();
        $this->withToken($foreign)->putJson(self::BASE . "/tankers/{$tankerId}", ['status' => 'inactive'])->assertNotFound();
        $this->withToken($foreign)->getJson(self::BASE . "/tanker-owners/{$ownerId}/company-links")->assertNotFound();
        $this->withToken($foreign)->postJson(self::BASE . "/tanker-owners/{$ownerId}/company-links/{$linkId}/end")->assertNotFound();
        // صهريج لصاحب صهريج من مستأجر آخر، وربط شركة مستأجر آخر.
        $this->withToken($foreign)->postJson(self::BASE . '/tankers', ['fuel_tanker_owner_id' => $ownerId, 'plate_number' => 'X-1'])->assertStatus(422);
        $this->withToken($foreign)->postJson(self::BASE . "/tanker-owners/{$foreignOwner}/company-links", ['partner_id' => $company->id])->assertStatus(422);

        // القوائم لا تسرّب، ورمز/لوحة نفس القيمة مسموحان عبر المستأجرين.
        $this->assertSame(['غريب'], collect($this->withToken($foreign)->getJson(self::BASE . '/tanker-owners')->json('data'))->pluck('name')->all());
        $this->assertCount(0, $this->withToken($foreign)->getJson(self::BASE . '/tankers')->json('data'));
        $this->withToken($foreign)->postJson(self::BASE . '/tankers', ['fuel_tanker_owner_id' => $foreignOwner, 'plate_number' => 'ISO-1'])->assertCreated();

        // لم يتغيّر شيء عند المستأجر الأول.
        $this->assertSame('عسكر', DB::table('fuel_tanker_owners')->where('id', $ownerId)->value('name'));
        $this->assertNull(DB::table('fuel_tanker_owner_company_links')->where('id', $linkId)->value('valid_to'));
    }

    // ───────────────────────── لا أثر مالي/مخزني، ولا PIN ─────────────────────────

    /** @test */
    public function no_accounting_inventory_invoice_or_payment_row_is_ever_written(): void
    {
        $this->fixture();
        $tables = ['journal_entries', 'journal_lines', 'stock_movements', 'product_warehouse_stock', 'invoices', 'invoice_lines', 'payments', 'payment_allocations',
            'fuel_sales', 'fuel_operational_ledgers', 'fuel_inventory_cost_movements'];
        $before = array_map(fn ($t) => Schema::hasTable($t) ? DB::table($t)->count() : -1, $tables);
        $partners = DB::table('partners')->count();

        $ownerId = $this->makeOwner('عسكر');
        $company = $this->makePartner('كيفير', 'customer');
        $partners++;
        $this->withToken($this->owner)->postJson(self::BASE . '/tankers', ['fuel_tanker_owner_id' => $ownerId, 'plate_number' => 'FIN-1'])->assertCreated();
        $linkId = $this->withToken($this->owner)->postJson(self::BASE . "/tanker-owners/{$ownerId}/company-links", ['partner_id' => $company->id])->assertCreated()->json('data.id');
        $this->withToken($this->owner)->postJson(self::BASE . "/tanker-owners/{$ownerId}/company-links/{$linkId}/end")->assertOk();

        $this->assertSame($before, array_map(fn ($t) => Schema::hasTable($t) ? DB::table($t)->count() : -1, $tables));
        $this->assertSame($partners, DB::table('partners')->count(), 'no Partner is created for an owner');
    }

    /** @test */
    public function the_service_source_never_touches_accounting_inventory_invoice_or_payment_services(): void
    {
        // يُفحص الكود لا التعليقات: كل رموز الكود (أسماء/استيرادات) بلا أي من الخدمات المحاسبية أو المخزنية.
        $code = '';
        foreach (token_get_all((string) file_get_contents(app_path('Services/FuelTankerService.php'))) as $token) {
            if (is_array($token) && ! in_array($token[0], [T_COMMENT, T_DOC_COMMENT], true)) {
                $code .= $token[1];
            }
        }
        foreach (['InventoryService', 'LedgerService', 'InvoiceService', 'PaymentService', 'FuelCostBasisService', 'StockMovement', 'JournalEntry', 'ZatcaService'] as $forbidden) {
            $this->assertStringNotContainsString($forbidden, $code, "{$forbidden} is out of scope for PR-1");
        }
    }

    /** @test */
    public function a_station_pin_session_cannot_reach_any_tanker_route(): void
    {
        foreach ([
            ['GET', 'api/fuel-stations/tanker-owners'], ['POST', 'api/fuel-stations/tanker-owners'], ['PUT', 'api/fuel-stations/tanker-owners/{id}'],
            ['GET', 'api/fuel-stations/tanker-owners/{id}/company-links'], ['POST', 'api/fuel-stations/tanker-owners/{id}/company-links/{linkId}/end'],
            ['GET', 'api/fuel-stations/tankers'], ['POST', 'api/fuel-stations/tankers'], ['PUT', 'api/fuel-stations/tankers/{id}'],
        ] as [$method, $uri]) {
            $this->assertFalse(StationSessionBoundary::routeAllowed($method, $uri), "{$method} {$uri} must be denied to a PIN session");
        }
    }

    /** @test */
    public function the_migration_refuses_to_roll_back_when_data_exists_and_all_tables_are_additive(): void
    {
        $this->fixture();
        $this->makeOwner('عسكر');

        $migration = require base_path('database/migrations/2027_01_23_010000_create_fuel_tanker_management_foundation.php');
        $thrown = null;
        try {
            $migration->down();
        } catch (\RuntimeException $e) {
            $thrown = $e;
        }
        $this->assertNotNull($thrown);
        $this->assertStringContainsString('Rollback refused', $thrown->getMessage());
        $this->assertTrue(Schema::hasTable('fuel_tanker_owners'));
    }

    // ───────────────────────── مساعدات ─────────────────────────

    private function makeOwner(string $name): string
    {
        return $this->withToken($this->owner)->postJson(self::BASE . '/tanker-owners', ['name' => $name])->assertCreated()->json('data.id');
    }

    private function makePartner(string $name, string $type, bool $active = true): Partner
    {
        app(TenantContext::class)->set($this->tenantId);

        return Partner::create(['type' => $type, 'name' => $name, 'is_active' => $active]);
    }

    private function grantFuel(string $tenantId, string $reason): void
    {
        app(TenantContext::class)->set($tenantId);
        app(EntitlementGrantService::class)->grant(
            Tenant::findOrFail($tenantId), 'fuel_stations.core', EntitlementAccessMode::FULL, EntitlementSourceType::MANUAL,
            CarbonImmutable::now('UTC'), grantReasonCode: $reason, reason: 'اختبار أساس أصحاب الصهاريج.',
        );
    }

    /** @param list<string> $permissions */
    private function tokenWithPermissions(array $permissions): string
    {
        app(TenantContext::class)->set($this->tenantId);
        $slug = 'tanker-' . substr(md5(json_encode($permissions) . microtime(true) . random_int(0, PHP_INT_MAX)), 0, 10);
        Role::create(['tenant_id' => $this->tenantId, 'slug' => $slug, 'name' => $slug, 'permissions' => $permissions, 'is_system' => false]);
        $user = User::create(['tenant_id' => $this->tenantId, 'name' => $slug, 'email' => "{$slug}@tanker.test", 'password' => 'password123', 'role' => $slug]);

        return $user->createToken('api')->plainTextToken;
    }

    private function fixture(bool $gateOpen = true): void
    {
        config(['fuel_stations.tanker_management_enabled' => $gateOpen]);
        $auth = $this->registerTenant('tanker-found', 'owner@tanker-found.test', autoEnableApplications: true);
        $this->tenantId = $auth['tenant_id'];
        $this->owner = $auth['token'];
        $this->grantFuel($this->tenantId, 'test_tanker_pr1');
    }
}
