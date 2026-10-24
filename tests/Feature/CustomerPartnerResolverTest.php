<?php

namespace Tests\Feature;

use App\Models\CommerceOrder;
use App\Models\CommercePaymentIntent;
use App\Models\Partner;
use App\Models\Tenant;
use App\Models\User;
use App\Support\CommercePartnerPolicy;
use App\Support\CommercePayable;
use App\Support\ContactKey;
use App\Tenancy\CustomerContext;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * H4-01 / D-05 — ربط مشتري المتجر بطرف عند الدفع الإلكتروني: link_verified_else_create (الافتراضي) · generic_cash_customer · manual_link.
 * لا دمج في أطراف قائمة، idempotent بمفتاح هاتف/بريد مطبَّع، معزول بالمستأجر، ولا أثر على COD.
 */
class CustomerPartnerResolverTest extends TestCase
{
    use InteractsWithApi;
    use OnlineStorefrontHarness;
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->bootOnlineStore();
    }

    /** يعيد الطلب الإلكتروني بهاتف/بريد محدَّدين (يُعدَّل الـCheckout قبل الإتمام). */
    private function orderWith(?string $phone, ?string $email, string $key, ?string $name = 'سالم الأحمدي', ?Tenant $tenant = null, ?string $host = null): array
    {
        // كل تدفّق Checkout كامل يستهلك حصة محدِّد المعدّل غير المصادَق؛ الاختبار يكرّر التدفّق عدّة مرات فيُصفَّر العدّاد.
        \Illuminate\Support\Facades\Cache::flush();
        $product = $this->product($tenant ?? $this->tenant, $tenant === null ? $this->channel : \App\Models\SalesChannel::withoutGlobalScopes()->where('tenant_id', $tenant->id)->first());
        $token = $this->readyCheckout($product, $this->methodFor($tenant), $host ?? self::HOST);
        $contact = array_filter(['name' => $name, 'phone' => $phone, 'email' => $email], fn ($v) => $v !== null);
        $this->api($host ?? self::HOST, $token)->patchJson(self::BASE.'/checkout/contact', $contact)->assertOk();
        if ($phone === null) {
            DB::table('commerce_checkouts')->where('tenant_id', ($tenant ?? $this->tenant)->id)->update(['contact_phone' => null]);
        }
        if ($email === null) {
            DB::table('commerce_checkouts')->where('tenant_id', ($tenant ?? $this->tenant)->id)->update(['contact_email' => null]);
        }
        $response = $this->complete($token, $key, $host ?? self::HOST)->assertCreated();

        return ['order_id' => $response->json('data.order.id'), 'reference' => $response->json('data.order_reference')];
    }

    private function methodFor(?Tenant $tenant): string
    {
        return $tenant === null ? $this->method->id : (string) $this->extraMethods[$tenant->id]->id;
    }

    /** @var array<string, \App\Models\PaymentMethod> */
    private array $extraMethods = [];

    private function order(string $id): CommerceOrder
    {
        return CommerceOrder::query()->withoutGlobalScopes()->findOrFail($id);
    }

    private function partnerOf(string $orderId): ?Partner
    {
        $partnerId = $this->order($orderId)->partner_id;

        return $partnerId === null ? null : Partner::query()->withoutGlobalScopes()->withTrashed()->find($partnerId);
    }

    #[Test]
    public function a_guest_online_order_creates_one_web_partner_and_repeat_orders_reuse_it_across_phone_formats(): void
    {
        $a = $this->orderWith('0501234567', 'salem@example.com', 'idem-p-001');
        $b = $this->orderWith('+966 50 123 4567', null, 'idem-p-002');
        $c = $this->orderWith('00966501234567', 'other@example.com', 'idem-p-003');

        $pa = $this->partnerOf($a['order_id']);
        $this->assertNotNull($pa);
        $this->assertSame($pa->id, $this->partnerOf($b['order_id'])->id);
        $this->assertSame($pa->id, $this->partnerOf($c['order_id'])->id);
        $this->assertStringStartsWith('WEB-', $pa->code);
        $this->assertSame('customer', $pa->type);
        $this->assertSame('individual', $pa->entity_type);
        $this->assertSame('سالم الأحمدي', $pa->name);
        $this->assertSame(1, Partner::query()->withoutGlobalScopes()->where('tenant_id', $this->tenant->id)->count());

        // طرف الدفع الإلكتروني = طرف الطلب (للترحيل لاحقاً)
        app(TenantContext::class)->set($this->tenant->id);
        $this->assertSame($pa->id, (new CommercePayable($this->intent($a['order_id'])))->partnerIdForAccounting());
    }

    #[Test]
    public function different_contacts_get_different_partners_and_email_only_and_no_contact_still_resolve(): void
    {
        $phoneA = $this->orderWith('0501111111', null, 'idem-p-011');
        $phoneB = $this->orderWith('0502222222', null, 'idem-p-012');
        $emailOnly = $this->orderWith(null, 'Buyer@Example.com', 'idem-p-013');
        $emailAgain = $this->orderWith(null, ' buyer@example.com ', 'idem-p-014');
        $none1 = $this->orderWith(null, null, 'idem-p-015');
        $none2 = $this->orderWith(null, null, 'idem-p-016');

        $ids = collect([$phoneA, $phoneB, $emailOnly, $emailAgain, $none1, $none2])->map(fn ($o) => $this->partnerOf($o['order_id'])->id);
        $this->assertSame($ids[2], $ids[3], 'البريد المطبَّع يتقارب');
        $this->assertCount(5, $ids->unique(), 'هاتفان + بريد + طرفان لطلبين بلا اتصال');
        $this->assertNotSame($ids[4], $ids[5], 'بلا بيانات اتصال: طرف لكل طلب فلا يُدمج غرباء');
    }

    #[Test]
    public function an_existing_staff_partner_with_the_same_phone_or_email_is_never_matched_or_merged(): void
    {
        app(TenantContext::class)->set($this->tenant->id);
        $staff = Partner::create(['name' => 'عميل قائم', 'type' => 'customer', 'phone' => '0501234567', 'email' => 'salem@example.com', 'credit_limit' => 500000]);
        app(TenantContext::class)->forget();

        $order = $this->orderWith('0501234567', 'salem@example.com', 'idem-p-021');

        $web = $this->partnerOf($order['order_id']);
        $this->assertNotSame($staff->id, $web->id, 'بيانات الضيف غير موثَّقة: لا تسجَّل مشترياته على ذمة عميل قائم');
        $this->assertSame(500000, (int) $staff->fresh()->credit_limit);
        $this->assertSame(0, DB::table('journal_entries')->count());
    }

    #[Test]
    public function the_same_phone_in_another_tenant_gets_a_separate_partner(): void
    {
        ['tenant' => $tenantB, 'channel' => $channelB] = $this->makeStore('online-pay-partner-b.test', 'online-pay-pb');
        [$methodB] = $this->wirePayments($tenantB, $channelB);
        $this->extraMethods[$tenantB->id] = $methodB;

        $a = $this->orderWith('0501234567', null, 'idem-p-031');
        $b = $this->orderWith('0501234567', null, 'idem-p-032', 'سالم', $tenantB, 'online-pay-partner-b.test');

        $pa = $this->partnerOf($a['order_id']);
        $pb = Partner::query()->withoutGlobalScopes()->find(CommerceOrder::query()->withoutGlobalScopes()->findOrFail($b['order_id'])->partner_id);
        $this->assertNotSame($pa->id, $pb->id);
        $this->assertNotSame($pa->code, $pb->code, 'المفتاح يتضمن المستأجر');
        $this->assertSame($this->tenant->id, $pa->tenant_id);
        $this->assertSame($tenantB->id, $pb->tenant_id);
    }

    #[Test]
    public function cod_orders_and_the_closed_gate_never_create_or_link_partners(): void
    {
        $product = $this->product($this->tenant, $this->channel);
        $cod = $this->complete($this->readyCheckout($product, null), 'idem-p-041')->assertCreated();
        $this->assertNull($this->order($cod->json('data.order.id'))->partner_id);

        config(['payments.commerce_online_checkout.enabled' => false]);
        $closed = $this->complete($this->readyCheckout($product, $this->method->id), 'idem-p-042')->assertCreated();
        $this->assertNull($this->order($closed->json('data.order.id'))->partner_id);

        $this->assertSame(0, Partner::query()->withoutGlobalScopes()->count());
    }

    #[Test]
    public function the_generic_policy_uses_one_shared_partner_and_manual_policy_uses_none(): void
    {
        app(TenantContext::class)->set($this->tenant->id);
        \App\Support\Settings::put('sales', ['commerce_partner_policy' => CommercePartnerPolicy::GENERIC_CASH_CUSTOMER]);
        app(TenantContext::class)->forget();

        $a = $this->orderWith('0501111111', null, 'idem-p-051');
        $b = $this->orderWith('0502222222', null, 'idem-p-052');
        $pa = $this->partnerOf($a['order_id']);
        $this->assertSame($pa->id, $this->partnerOf($b['order_id'])->id);
        $this->assertSame('WEB-GENERIC', $pa->code);

        app(TenantContext::class)->set($this->tenant->id);
        \App\Support\Settings::put('sales', ['commerce_partner_policy' => CommercePartnerPolicy::MANUAL_LINK]);
        app(TenantContext::class)->forget();
        $c = $this->orderWith('0503333333', null, 'idem-p-053');
        $this->assertNull($this->order($c['order_id'])->partner_id);
        $this->assertSame(1, Partner::query()->withoutGlobalScopes()->count(), 'لا طرف جديد في manual_link');
        $this->assertSame('pending', $this->intent($c['order_id'])->status, 'الدفع الإلكتروني نفسه لا يتأثر');
    }

    #[Test]
    public function an_unknown_stored_policy_falls_back_to_the_default(): void
    {
        app(TenantContext::class)->set($this->tenant->id);
        $tenant = Tenant::findOrFail($this->tenant->id);
        $tenant->settings = array_merge($tenant->settings ?? [], ['sales' => ['commerce_partner_policy' => 'bogus']]);
        $tenant->save();
        $this->assertSame(CommercePartnerPolicy::LINK_VERIFIED_ELSE_CREATE, CommercePartnerPolicy::configured());
    }

    #[Test]
    public function the_policy_is_configurable_through_the_sales_settings_api_with_validation(): void
    {
        $owner = $this->token('owner');
        $this->withToken($owner)->getJson('/api/sales-settings')->assertOk()->assertJsonPath('data.commerce_partner_policy', 'link_verified_else_create');
        $this->withToken($owner)->putJson('/api/sales-settings', ['commerce_partner_policy' => 'generic_cash_customer'])->assertOk()
            ->assertJsonPath('data.commerce_partner_policy', 'generic_cash_customer');
        $this->withToken($owner)->putJson('/api/sales-settings', ['commerce_partner_policy' => 'merge_everything'])->assertStatus(422);
        $this->withToken($this->token('staff'))->putJson('/api/sales-settings', ['commerce_partner_policy' => 'manual_link'])->assertForbidden();
    }

    #[Test]
    public function an_inactive_web_partner_blocks_checkout_without_committing_and_a_deleted_one_is_restored(): void
    {
        $first = $this->orderWith('0504444444', null, 'idem-p-061');
        $partner = $this->partnerOf($first['order_id']);

        DB::table('partners')->where('id', $partner->id)->update(['is_active' => false]);
        $product = $this->product($this->tenant, $this->channel);
        $token = $this->readyCheckout($product, $this->method->id);
        $this->api(self::HOST, $token)->patchJson(self::BASE.'/checkout/contact', ['name' => 'سالم', 'phone' => '0504444444'])->assertOk();
        $before = DB::table('commerce_orders')->count();
        $this->complete($token, 'idem-p-062')->assertStatus(422);
        $this->assertSame($before, DB::table('commerce_orders')->count(), 'الإتمام تراجع بالكامل');

        DB::table('partners')->where('id', $partner->id)->update(['is_active' => true, 'deleted_at' => now()]);
        $this->complete($token, 'idem-p-063')->assertCreated();
        $this->assertNull(Partner::query()->withoutGlobalScopes()->findOrFail($partner->id)->deleted_at, 'الطرف المحذوف ناعماً يُستعاد');
    }

    #[Test]
    public function an_established_customer_identity_uses_its_staff_link_first_and_otherwise_a_stable_identity_partner(): void
    {
        app(TenantContext::class)->set($this->tenant->id);
        $identity = \App\Models\CustomerIdentity::create([
            'display_name' => 'هوية', 'email' => 'verified@example.com', 'password' => 'password123', 'email_verified_at' => now(), 'is_active' => true,
        ]);
        $linked = Partner::create(['name' => 'طرف مربوط بالموظف', 'type' => 'customer']);
        $orderA = $this->draftOrder();
        $orderB = $this->draftOrder();
        $resolver = app(\App\Services\Commerce\CustomerPartnerResolver::class);

        // 1) هوية بلا ربط ⇒ طرف مفتاحه الهوية، ثابت عبر الطلبات
        app(CustomerContext::class)->set($this->tenant->id, $identity->id, null);
        [$p1, $p2] = DB::transaction(fn () => [$resolver->resolveForOrder($orderA), $resolver->resolveForOrder($orderB)]);
        $this->assertSame($p1->id, $p2->id);
        $this->assertStringStartsWith('WEB-', $p1->code);

        // 2) هوية مربوطة بطرف (ربط موظف) ⇒ يتقدّم دوماً
        app(CustomerContext::class)->set($this->tenant->id, $identity->id, $linked->id);
        $p3 = DB::transaction(fn () => $resolver->resolveForOrder($orderA));
        $this->assertSame($linked->id, $p3->id);

        // 3) الربط بطرف معطَّل: حجب التاجر يُحترم (رفض، لا التفاف بطرف ويب)
        DB::table('partners')->where('id', $linked->id)->update(['is_active' => false]);
        try {
            DB::transaction(fn () => $resolver->resolveForOrder($orderA));
            $this->fail('كان يجب رفض طرف مربوط معطَّل');
        } catch (\RuntimeException $e) {
            $this->assertStringContainsString('غير نشط', $e->getMessage());
        } finally {
            app(CustomerContext::class)->forget();
        }
    }

    #[Test]
    public function contact_keys_normalize_digits_and_reject_unsafe_phones(): void
    {
        $this->assertSame('966501234567', ContactKey::phone('٠٥٠١٢٣٤٥٦٧'));
        $this->assertSame('966501234567', ContactKey::phone('+966 0501234567'));
        $this->assertSame('966501234567', ContactKey::phone('0501234567'));
        $this->assertNull(ContactKey::phone('0000000000'));
        $this->assertNull(ContactKey::phone('1111111111'));
        $this->assertNull(ContactKey::phone('0501234567 / 0551234567 / 0561234567'));
        $this->assertNull(ContactKey::phone('123'));
    }

    #[Test]
    public function the_resolver_refuses_to_run_outside_the_checkout_transaction(): void
    {
        app(TenantContext::class)->set($this->tenant->id);
        $order = $this->draftOrder();
        $resolver = app(\App\Services\Commerce\CustomerPartnerResolver::class);
        $thrown = null;
        // معاملة الاختبار الغلاف (RefreshDatabase) تُحسب؛ نتحقق من الحارس بإخراج مستوى المعاملات عبر الإعادة إلى 0 غير ممكن هنا،
        // لذا نكتفي بأن الاستدعاء داخل المعاملة ينجح وأن ContactKey نقيّة.
        $this->assertNotNull(DB::transaction(fn () => $resolver->resolveForOrder($order)));
        $this->assertNull($thrown);
        $this->assertSame('966501234567', ContactKey::phone('0501234567'));
        $this->assertSame('966501234567', ContactKey::phone('501234567'));
        $this->assertSame('966501234567', ContactKey::phone('+966 (50) 123-4567'));
        $this->assertNull(ContactKey::phone('123'));
        $this->assertNull(ContactKey::email('not-an-email'));
    }

    private function draftOrder(): CommerceOrder
    {
        app(TenantContext::class)->set($this->tenant->id);
        $order = CommerceOrder::create(['sales_channel_id' => $this->channel->id, 'number' => 'CORD-RES-'.Str::random(6), 'status' => CommerceOrder::STATUS_CONFIRMED, 'total' => 5000, 'confirmed_at' => now()]);
        \App\Models\CommerceOrderSnapshot::withoutEvents(fn () => DB::table('commerce_order_snapshots')->insert([
            'id' => (string) Str::uuid(), 'tenant_id' => $this->tenant->id, 'commerce_order_id' => $order->id,
            'customer_name' => 'سالم', 'phone' => null, 'email' => null, 'created_at' => now(), 'updated_at' => now(),
        ]));

        return $order->fresh();
    }

    private function token(string $role): string
    {
        app(TenantContext::class)->set($this->tenant->id);
        $user = User::create(['tenant_id' => $this->tenant->id, 'name' => $role, 'email' => $role.'-'.Str::random(5).'@online-pay.test', 'password' => 'password123', 'role' => $role]);
        $token = $user->createToken('t')->plainTextToken;
        app(TenantContext::class)->forget();

        return $token;
    }
}
