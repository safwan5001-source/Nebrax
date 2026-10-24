<?php

namespace Tests\Feature;

use App\Models\PaymentGateway;
use App\Models\PaymentProviderEvent;
use App\Models\Tenant;
use App\Tenancy\TenantContext;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/** PAY-H8-01 / D-20 (R-22): أجسام أحداث المزوّد تُصفَّر بعد 180 يوماً وتبقى البصمة؛ لا حذف ولا مساس بغير الجسم؛ الجدولة مغلقة افتراضياً. */
class PaymentEventBodyRetentionTest extends TestCase
{
    use RefreshDatabase;

    /** @return array{0: Tenant, 1: PaymentGateway} */
    private function tenantWithGateway(string $slug): array
    {
        $tenant = Tenant::create(['name' => "شركة {$slug}", 'slug' => $slug, 'vat_number' => '300000000000013', 'currency' => 'SAR']);
        app(TenantContext::class)->set($tenant->id);

        return [$tenant, PaymentGateway::query()->create(['provider' => 'fake', 'name' => 'Fake', 'environment' => 'sandbox'])];
    }

    private function event(PaymentGateway $gateway, string $id, int $ageDays): string
    {
        $event = PaymentProviderEvent::query()->create([
            'payment_gateway_id' => $gateway->id, 'provider' => 'fake', 'provider_event_id' => $id, 'event_type' => 'payment_paid',
            'provider_payment_id' => 'pay_'.$id, 'body_hash' => hash('sha256', $id), 'body' => '{"card":"4111 1111 1111 1111","id":"'.$id.'"}',
            'status' => 'processed', 'outcome' => 'applied',
        ]);
        DB::table('payment_provider_events')->where('id', $event->id)->update(['received_at' => now('UTC')->subDays($ageDays)->format('Y-m-d H:i:s.u')]);

        return (string) $event->id;
    }

    private function bodyOf(string $id): ?string
    {
        return DB::table('payment_provider_events')->where('id', $id)->value('body');
    }

    #[Test]
    public function old_bodies_are_cleared_across_tenants_while_the_hash_and_identity_remain(): void
    {
        [, $a] = $this->tenantWithGateway('retention-a');
        $old = $this->event($a, 'evt_old', 200);
        $edgeOver = $this->event($a, 'evt_181', 181);
        $edgeUnder = $this->event($a, 'evt_179', 179);
        $recent = $this->event($a, 'evt_recent', 1);
        [, $b] = $this->tenantWithGateway('retention-b');
        $otherTenantOld = $this->event($b, 'evt_b_old', 400);

        $strip = fn (object $r): array => collect((array) $r)->except('body')->all();
        $before = $strip(DB::table('payment_provider_events')->where('id', $old)->first());

        $this->assertSame(0, Artisan::call('payments:purge-event-bodies'));
        $out = json_decode(Artisan::output(), true);

        $this->assertSame(['dry_run' => false, 'days' => 180, 'cleared' => 3], $out);
        foreach ([$old, $edgeOver, $otherTenantOld] as $id) {
            $this->assertNull($this->bodyOf($id));
        }
        foreach ([$edgeUnder, $recent] as $id) {
            $this->assertNotNull($this->bodyOf($id));
        }
        $this->assertSame($before, $strip(DB::table('payment_provider_events')->where('id', $old)->first()), 'لا يتغيّر غير الجسم (البصمة والمعرّف والحالة والنتيجة)');
        $this->assertSame(5, DB::table('payment_provider_events')->count(), 'لا حذف أبداً');

        // idempotent
        Artisan::call('payments:purge-event-bodies');
        $this->assertSame(0, json_decode(Artisan::output(), true)['cleared']);
    }

    #[Test]
    public function dry_run_changes_nothing_and_the_window_has_a_floor(): void
    {
        [, $gateway] = $this->tenantWithGateway('retention-dry');
        $old = $this->event($gateway, 'evt_dry', 300);

        Artisan::call('payments:purge-event-bodies', ['--dry-run' => true]);
        $this->assertSame(['dry_run' => true, 'days' => 180, 'candidates' => 1], json_decode(Artisan::output(), true));
        $this->assertNotNull($this->bodyOf($old));

        $this->assertSame(2, Artisan::call('payments:purge-event-bodies', ['--days' => 10]));
        $this->assertStringContainsString('invalid_days', Artisan::output());
        $this->assertNotNull($this->bodyOf($old));

        Artisan::call('payments:purge-event-bodies', ['--days' => 365]);
        $this->assertSame(0, json_decode(Artisan::output(), true)['cleared'], 'نافذة أطول ⇒ لا تصفير');
        Artisan::call('payments:purge-event-bodies', ['--days' => 200, '--batch' => 1]);
        $this->assertSame(1, json_decode(Artisan::output(), true)['cleared']);
    }

    #[Test]
    public function the_body_can_only_be_cleared_never_rewritten_and_events_are_never_deleted(): void
    {
        [, $gateway] = $this->tenantWithGateway('retention-guard');
        $event = PaymentProviderEvent::query()->findOrFail($this->event($gateway, 'evt_guard', 5));

        $event->body = '{"tampered":true}';
        try {
            $event->save();
            $this->fail('إعادة كتابة الجسم يجب أن تُرفض');
        } catch (\LogicException $e) {
            $this->assertStringContainsString('only be cleared', $e->getMessage());
        }
        try {
            $event->fresh()->delete();
            $this->fail('الحذف يجب أن يُرفض');
        } catch (\LogicException $e) {
            $this->assertStringContainsString('never deleted', $e->getMessage());
        }
    }

    #[Test]
    public function the_schedule_is_closed_by_default_and_opens_only_by_explicit_config(): void
    {
        $find = fn () => collect(app(Schedule::class)->events())->first(fn ($e) => str_contains((string) $e->command, 'payments:purge-event-bodies'));

        $this->assertNotNull($find(), 'الأمر مجدول');
        $this->assertFalse($find()->filtersPass($this->app), 'مغلق افتراضياً');
        config(['payments.event_body_retention.enabled' => true]);
        $this->assertTrue($find()->filtersPass($this->app));
    }
}
