<?php

namespace Tests\Feature;

use App\Models\Shift;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * ورديات العمل — الوحدة الثانية من معمار الموارد البشرية.
 * تشغيل:  php artisan test --filter=ShiftTest
 */
class ShiftTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function payload(array $over = []): array
    {
        return array_merge([
            'name' => 'الوردية الصباحية',
            'start_time' => '08:00',
            'end_time' => '16:00',
            'break_minutes' => 30,
            'work_days' => [0, 1, 2, 3, 4],
        ], $over);
    }

    /** @test */
    public function it_creates_a_shift_and_derives_net_minutes(): void
    {
        $auth = $this->registerTenant();

        $res = $this->withToken($auth['token'])->postJson('/api/shifts', $this->payload())
            ->assertCreated();

        $res->assertJsonPath('data.name', 'الوردية الصباحية');
        $res->assertJsonPath('data.start_time', '08:00');
        $res->assertJsonPath('data.work_days', [0, 1, 2, 3, 4]);
        // 8 ساعات − 30 دقيقة استراحة = 450 دقيقة
        $res->assertJsonPath('data.net_minutes', 450);

        $this->withToken($auth['token'])->getJson('/api/shifts')->assertOk()->assertJsonCount(1, 'data');
    }

    /** @test */
    public function a_night_shift_crossing_midnight_computes_net_minutes_over_24h(): void
    {
        $auth = $this->registerTenant();

        // 22:00 → 06:00 = 8 ساعات، − 60 استراحة = 420 دقيقة
        $this->withToken($auth['token'])->postJson('/api/shifts', $this->payload([
            'start_time' => '22:00', 'end_time' => '06:00', 'break_minutes' => 60,
        ]))->assertCreated()->assertJsonPath('data.net_minutes', 420);
    }

    /** @test */
    public function work_days_are_deduplicated_and_sorted(): void
    {
        $auth = $this->registerTenant();

        $this->withToken($auth['token'])->postJson('/api/shifts', $this->payload([
            'work_days' => [4, 1, 1, 0, 2],
        ]))->assertCreated()->assertJsonPath('data.work_days', [0, 1, 2, 4]);
    }

    /** @test */
    public function an_invalid_work_day_is_rejected(): void
    {
        $auth = $this->registerTenant();

        $this->withToken($auth['token'])->postJson('/api/shifts', $this->payload([
            'work_days' => [0, 7], // 7 خارج المدى 0..6
        ]))->assertStatus(422)->assertJsonValidationErrors('work_days.1');

        // بلا أيام عمل يُرفض
        $this->withToken($auth['token'])->postJson('/api/shifts', $this->payload([
            'work_days' => [],
        ]))->assertStatus(422)->assertJsonValidationErrors('work_days');
    }

    /** @test */
    public function a_shift_can_be_updated_and_deleted(): void
    {
        $auth = $this->registerTenant();
        $id = $this->withToken($auth['token'])->postJson('/api/shifts', $this->payload())['data']['id'];

        $this->withToken($auth['token'])->putJson("/api/shifts/{$id}", $this->payload([
            'name' => 'الوردية المسائية', 'start_time' => '14:00', 'end_time' => '22:00', 'break_minutes' => 0,
        ]))->assertOk()->assertJsonPath('data.name', 'الوردية المسائية')->assertJsonPath('data.net_minutes', 480);

        $this->withToken($auth['token'])->deleteJson("/api/shifts/{$id}")->assertOk();
        $this->withToken($auth['token'])->getJson('/api/shifts')->assertJsonCount(0, 'data');
    }

    /** @test */
    public function a_branch_of_another_tenant_cannot_be_tagged(): void
    {
        $other = $this->registerTenant('other', 'owner@other.test');
        $otherBranchId = $this->withToken($other['token'])->getJson('/api/branches')->assertOk()['data'][0]['id'];

        $auth = $this->registerTenant('acme', 'owner@acme.test');
        $this->withToken($auth['token'])->postJson('/api/shifts', $this->payload([
            'branch_id' => $otherBranchId,
        ]))->assertStatus(422);
    }

    /** @test */
    public function shifts_are_tenant_isolated(): void
    {
        $a = $this->registerTenant('acme', 'owner@acme.test');
        $this->withToken($a['token'])->postJson('/api/shifts', $this->payload())->assertCreated();

        $b = $this->registerTenant('other', 'owner@other.test');
        // مستأجر آخر لا يرى ورديات الأول.
        $this->withToken($b['token'])->getJson('/api/shifts')->assertOk()->assertJsonCount(0, 'data');
    }

    /** @test */
    public function shifts_are_isolated_by_active_branch(): void
    {
        $auth = $this->registerTenant();
        $main   = $this->withToken($auth['token'])->getJson('/api/branches')['data'][0]['id'];
        $khobar = $this->withToken($auth['token'])->postJson('/api/branches', ['name' => 'فرع الخبر'])
            ->assertCreated()['data']['id'];

        // وردية أُنشئت من فرع الخبر — تُوسَم بالفرع النشط (BranchScoped).
        $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $khobar])
            ->postJson('/api/shifts', $this->payload())->assertCreated();

        // الفرع الرئيسي لا يراها؛ وفرعُها يراها. هذا جوهر BranchScoped الذي
        // يفرضه مرجع دفترة للورديات (خلافاً لسجلّ الموظف المركزي).
        $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $main])
            ->getJson('/api/shifts')->assertOk()->assertJsonCount(0, 'data');
        $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $khobar])
            ->getJson('/api/shifts')->assertOk()->assertJsonCount(1, 'data');
    }

    /** @test */
    public function net_minutes_helper_matches_the_model(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $shift = Shift::create($this->payload() + ['work_days' => [0, 1, 2, 3, 4]]);
        $this->assertSame(450, $shift->netMinutes());
    }
}
