<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class PosShiftTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private int $sequence = 0;

    /** @return array{id:string,warehouse_id:string} */
    private function device(array $auth, array $headers = []): array
    {
        $n = ++$this->sequence;
        $warehouse = $this->withToken($auth['token'])->withHeaders($headers)->postJson('/api/warehouses', [
            'name' => "مخزن وردية POS {$n}",
            'code' => "POS-SHIFT-W-{$n}",
            'is_active' => true,
        ])->assertCreated()['data'];

        $device = $this->withToken($auth['token'])->withHeaders($headers)->postJson('/api/pos-devices', [
            'name' => "جهاز وردية POS {$n}",
            'code' => "POS-SHIFT-D-{$n}",
            'warehouse_id' => $warehouse['id'],
            'is_active' => true,
        ])->assertCreated()['data'];

        return ['id' => $device['id'], 'warehouse_id' => $warehouse['id']];
    }

    /** @test */
    public function a_new_session_snapshots_the_pos_shift_without_writing_the_legacy_hr_shift(): void
    {
        $auth = $this->registerTenant();
        $device = $this->device($auth);
        $shift = $this->withToken($auth['token'])->postJson('/api/pos-shifts', [
            'name' => 'وردية الصباح POS',
            'code' => 'POS-AM',
            'is_active' => true,
        ])->assertCreated()['data'];

        $session = $this->withToken($auth['token'])->postJson('/api/pos-sessions/open', [
            'opening_balance' => 25000,
            'pos_device_id' => $device['id'],
            'pos_shift_id' => $shift['id'],
        ])->assertCreated()
            ->assertJsonPath('data.pos_shift_id', $shift['id'])
            ->assertJsonPath('data.pos_shift.id', $shift['id'])
            ->assertJsonPath('data.shift_id', null)['data'];

        $this->assertDatabaseHas('pos_sessions', [
            'id' => $session['id'],
            'pos_device_id' => $device['id'],
            'pos_shift_id' => $shift['id'],
            'shift_id' => null,
            'status' => 'open',
        ]);
    }

    /** @test */
    public function an_inactive_pos_shift_cannot_open_a_session(): void
    {
        $auth = $this->registerTenant();
        $device = $this->device($auth);
        $shift = $this->withToken($auth['token'])->postJson('/api/pos-shifts', [
            'name' => 'وردية معطلة',
            'code' => 'POS-OFF',
            'is_active' => false,
        ])->assertCreated()['data'];

        $this->withToken($auth['token'])->postJson('/api/pos-sessions/open', [
            'opening_balance' => 0,
            'pos_device_id' => $device['id'],
            'pos_shift_id' => $shift['id'],
        ])->assertStatus(422);

        $this->assertDatabaseMissing('pos_sessions', [
            'pos_device_id' => $device['id'],
            'pos_shift_id' => $shift['id'],
        ]);
    }

    /** @test */
    public function pos_shift_codes_are_unique_inside_the_active_branch(): void
    {
        $auth = $this->registerTenant();

        $this->withToken($auth['token'])->postJson('/api/pos-shifts', [
            'name' => 'وردية أولى',
            'code' => 'POS-1',
            'is_active' => true,
        ])->assertCreated();

        $this->withToken($auth['token'])->postJson('/api/pos-shifts', [
            'name' => 'وردية أخرى',
            'code' => 'POS-1',
            'is_active' => true,
        ])->assertUnprocessable()->assertJsonValidationErrors('code');
    }

    /** @test */
    public function pos_shifts_are_isolated_by_the_active_branch(): void
    {
        $auth = $this->registerTenant();
        $main = $this->withToken($auth['token'])->getJson('/api/branches')->assertOk()['data'][0]['id'];
        $other = $this->withToken($auth['token'])->postJson('/api/branches', [
            'name' => 'فرع ورديات POS',
        ])->assertCreated()['data']['id'];
        $otherHeaders = ['X-Branch-Id' => $other];

        $shift = $this->withToken($auth['token'])->withHeaders($otherHeaders)->postJson('/api/pos-shifts', [
            'name' => 'وردية الفرع الآخر',
            'code' => 'POS-BRANCH',
            'is_active' => true,
        ])->assertCreated()['data'];

        $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $main])
            ->getJson('/api/pos-shifts')->assertOk()->assertJsonCount(0, 'data');
        $this->withToken($auth['token'])->withHeaders($otherHeaders)
            ->getJson('/api/pos-shifts')->assertOk()->assertJsonCount(1, 'data');

        $mainDevice = $this->device($auth, ['X-Branch-Id' => $main]);
        $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $main])->postJson('/api/pos-sessions/open', [
            'opening_balance' => 0,
            'pos_device_id' => $mainDevice['id'],
            'pos_shift_id' => $shift['id'],
        ])->assertStatus(422);
    }

    /** @test */
    public function a_pos_shift_linked_to_sessions_cannot_be_deleted(): void
    {
        $auth = $this->registerTenant();
        $device = $this->device($auth);
        $shift = $this->withToken($auth['token'])->postJson('/api/pos-shifts', [
            'name' => 'وردية مستخدمة',
            'code' => 'POS-USED',
            'is_active' => true,
        ])->assertCreated()['data'];

        $this->withToken($auth['token'])->postJson('/api/pos-sessions/open', [
            'opening_balance' => 0,
            'pos_device_id' => $device['id'],
            'pos_shift_id' => $shift['id'],
        ])->assertCreated();

        $this->withToken($auth['token'])->deleteJson("/api/pos-shifts/{$shift['id']}")
            ->assertUnprocessable();

        $this->assertDatabaseHas('pos_shifts', ['id' => $shift['id']]);
    }
}
