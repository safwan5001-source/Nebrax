<?php

namespace Tests\Feature;

use App\Models\PaymentMethod;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/** تخصيص طريقة الدفع بصرياً (أيقونة Lucide بلون، أو شعار مرفوع): اختياري، متنافٍ، معزول بالمستأجر، بلا أثر مالي. */
class PaymentMethodVisualTest extends TestCase
{
    use InteractsWithApi;
    use RefreshDatabase;

    private function tenant(string $slug): array
    {
        $auth = $this->registerTenant($slug, "owner@{$slug}.test");
        app(TenantContext::class)->set($auth['tenant_id']);

        return $auth;
    }

    private function methods(array $auth): array
    {
        return $this->withToken($auth['token'])->getJson('/api/payment-methods')->assertOk()['data'];
    }

    private function cashMethod(array $auth): array
    {
        return collect($this->methods($auth))->firstWhere('name', 'نقدي');
    }

    private function body(array $m, array $changes = []): array
    {
        return [...[
            'name' => $m['name'], 'name_en' => $m['name_en'], 'settlement_type' => $m['settlement_type'],
            'cash_bank_account_id' => $m['cash_bank_account_id'], 'instructions' => $m['instructions'],
            'available_online' => $m['available_online'], 'is_active' => $m['is_active'], 'is_default' => $m['is_default'],
        ], ...$changes];
    }

    private function putVisual(array $auth, array $m, array $changes)
    {
        return $this->withToken($auth['token'])->putJson("/api/payment-methods/{$m['id']}", $this->body($m, $changes));
    }

    #[Test]
    public function legacy_methods_and_clients_without_visual_fields_stay_valid_and_default(): void
    {
        $auth = $this->tenant('pmv-legacy');
        $m = $this->cashMethod($auth);

        $this->assertSame('default', $m['visual_mode']);
        $this->assertNull($m['icon_key']);
        $this->assertNull($m['icon_color']);
        $this->assertFalse($m['has_logo']);

        // عميل قديم يحدّث بلا أي حقل بصري ⇒ لا يتغير شيء.
        $this->putVisual($auth, $m, ['instructions' => 'x'])->assertOk()->assertJsonPath('data.visual_mode', 'default');
    }

    #[Test]
    public function an_icon_and_independent_color_persist_and_omitting_them_later_keeps_them(): void
    {
        $auth = $this->tenant('pmv-icon');
        $m = $this->cashMethod($auth);

        $this->putVisual($auth, $m, ['visual_mode' => 'icon', 'icon_key' => 'wallet', 'icon_color' => '#1A2b3C'])
            ->assertOk()
            ->assertJsonPath('data.visual_mode', 'icon')->assertJsonPath('data.icon_key', 'wallet')->assertJsonPath('data.icon_color', '#1A2b3C');

        // تحديث لاحق بلا حقول بصرية (مثل التفعيل/التعطيل) يُبقي الاختيار.
        $this->putVisual($auth, $m, ['instructions' => 'تعليمات'])->assertOk()
            ->assertJsonPath('data.icon_key', 'wallet')->assertJsonPath('data.icon_color', '#1A2b3C');

        // تغيير اللون وحده، ثم إعادته للافتراضي (null) مع بقاء الأيقونة.
        $this->putVisual($auth, $m, ['icon_color' => '#000000'])->assertOk()->assertJsonPath('data.icon_color', '#000000')->assertJsonPath('data.icon_key', 'wallet');
        $this->putVisual($auth, $m, ['icon_color' => null])->assertOk()->assertJsonPath('data.icon_color', null)->assertJsonPath('data.icon_key', 'wallet');

        $this->assertSame('wallet', $this->cashMethod($auth)['icon_key']);
    }

    #[Test]
    public function invalid_icon_key_color_mode_and_missing_icon_are_rejected(): void
    {
        $auth = $this->tenant('pmv-validate');
        $m = $this->cashMethod($auth);

        $this->putVisual($auth, $m, ['visual_mode' => 'icon', 'icon_key' => 'skull'])->assertStatus(422)->assertJsonValidationErrors('icon_key');
        $this->putVisual($auth, $m, ['visual_mode' => 'icon', 'icon_key' => '../../etc'])->assertStatus(422);
        foreach (['red', '#FFF', '#GGGGGG', '#1234567', 'url(javascript:x)', '#12345;}body{x:y'] as $bad) {
            $this->putVisual($auth, $m, ['visual_mode' => 'icon', 'icon_key' => 'wallet', 'icon_color' => $bad])->assertStatus(422)->assertJsonValidationErrors('icon_color');
        }
        $this->putVisual($auth, $m, ['visual_mode' => 'sparkle'])->assertStatus(422)->assertJsonValidationErrors('visual_mode');
        $this->putVisual($auth, $m, ['visual_mode' => 'icon'])->assertStatus(422);       // أيقونة بلا مفتاح
        $this->putVisual($auth, $m, ['visual_mode' => 'image'])->assertStatus(422);      // صورة بلا شعار

        $this->assertSame('default', $this->cashMethod($auth)['visual_mode']);
    }

    #[Test]
    public function a_logo_can_be_uploaded_served_replaced_and_removed_and_is_exclusive_with_the_icon(): void
    {
        Storage::fake('local');
        $auth = $this->tenant('pmv-logo');
        $m = $this->cashMethod($auth);

        $this->withToken($auth['token'])->getJson("/api/payment-methods/{$m['id']}/logo")->assertStatus(404);

        $this->withToken($auth['token'])->put("/api/payment-methods/{$m['id']}", $this->body($m, ['visual_mode' => 'icon', 'icon_key' => 'coins', 'icon_color' => '#112233']));
        $res = $this->withToken($auth['token'])->postJson("/api/payment-methods/{$m['id']}/logo", ['logo' => UploadedFile::fake()->image('a.png', 100, 100)])->assertOk();
        $res->assertJsonPath('data.visual_mode', 'image')->assertJsonPath('data.has_logo', true)->assertJsonPath('data.icon_key', null)->assertJsonPath('data.icon_color', null);

        $first = PaymentMethod::findOrFail($m['id'])->logo_path;
        Storage::disk('local')->assertExists($first);
        $this->withToken($auth['token'])->get("/api/payment-methods/{$m['id']}/logo")->assertOk()->assertHeader('X-Content-Type-Options', 'nosniff');

        // استبدال ⇒ القديم يُحذف.
        $this->withToken($auth['token'])->postJson("/api/payment-methods/{$m['id']}/logo", ['logo' => UploadedFile::fake()->image('b.jpg', 80, 80)])->assertOk();
        Storage::disk('local')->assertMissing($first);
        $second = PaymentMethod::findOrFail($m['id'])->logo_path;
        Storage::disk('local')->assertExists($second);

        // اختيار أيقونة بعد الصورة يُسقط الشعار (تنافٍ) ولا يترك يتيماً.
        $this->putVisual($auth, $m, ['visual_mode' => 'icon', 'icon_key' => 'landmark'])->assertOk()->assertJsonPath('data.has_logo', false)->assertJsonPath('data.icon_key', 'landmark');
        Storage::disk('local')->assertMissing($second);

        // رفع ثم إزالة ⇒ افتراضي وبلا ملف.
        $this->withToken($auth['token'])->postJson("/api/payment-methods/{$m['id']}/logo", ['logo' => UploadedFile::fake()->image('c.webp', 50, 50)])->assertOk();
        $third = PaymentMethod::findOrFail($m['id'])->logo_path;
        $this->withToken($auth['token'])->deleteJson("/api/payment-methods/{$m['id']}/logo")->assertOk()
            ->assertJsonPath('data.has_logo', false)->assertJsonPath('data.visual_mode', 'default');
        Storage::disk('local')->assertMissing($third);
    }

    #[Test]
    public function svg_non_image_oversize_and_oversized_dimensions_are_rejected_without_changing_state(): void
    {
        Storage::fake('local');
        $auth = $this->tenant('pmv-reject');
        $m = $this->cashMethod($auth);
        $url = "/api/payment-methods/{$m['id']}/logo";

        $svg = UploadedFile::fake()->createWithContent('x.svg', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
        $this->withToken($auth['token'])->postJson($url, ['logo' => $svg])->assertStatus(422)->assertJsonValidationErrors('logo');
        $this->withToken($auth['token'])->postJson($url, ['logo' => UploadedFile::fake()->create('x.pdf', 10, 'application/pdf')])->assertStatus(422);
        $this->withToken($auth['token'])->postJson($url, ['logo' => UploadedFile::fake()->create('x.png', 10, 'image/png')])->assertStatus(422); // امتداد صورة بمحتوى زائف
        $this->withToken($auth['token'])->postJson($url, ['logo' => UploadedFile::fake()->image('big.png', 100, 100)->size(2048)])->assertStatus(422);
        $this->withToken($auth['token'])->postJson($url, ['logo' => UploadedFile::fake()->image('wide.png', 2400, 100)])->assertStatus(422);
        $this->withToken($auth['token'])->postJson($url, [])->assertStatus(422);

        $this->assertFalse(PaymentMethod::findOrFail($m['id'])->logo_path !== null);
        $this->assertSame([], Storage::disk('local')->allFiles());
    }

    #[Test]
    public function permissions_gate_manage_and_view_and_tenants_are_isolated(): void
    {
        Storage::fake('local');
        $a = $this->tenant('pmv-iso-a');
        $b = $this->tenant('pmv-iso-b');
        app(TenantContext::class)->set($a['tenant_id']);
        $mA = $this->cashMethod($a);
        $this->withToken($a['token'])->postJson("/api/payment-methods/{$mA['id']}/logo", ['logo' => UploadedFile::fake()->image('a.png', 40, 40)])->assertOk();

        // مستأجر آخر لا يقرأ ولا يكتب ولا يحذف شعار طريقة غيره (404 بعزل النطاق).
        $this->withToken($b['token'])->get("/api/payment-methods/{$mA['id']}/logo")->assertStatus(404);
        $this->withToken($b['token'])->postJson("/api/payment-methods/{$mA['id']}/logo", ['logo' => UploadedFile::fake()->image('x.png', 40, 40)])->assertStatus(404);
        $this->withToken($b['token'])->deleteJson("/api/payment-methods/{$mA['id']}/logo")->assertStatus(404);
        $this->withToken($b['token'])->putJson("/api/payment-methods/{$mA['id']}", $this->body($mA, ['visual_mode' => 'icon', 'icon_key' => 'wallet']))->assertStatus(404);
        app(TenantContext::class)->set($a['tenant_id']);
        $this->assertNotNull(PaymentMethod::findOrFail($mA['id'])->logo_path);

        // دور بلا payments.manage لا يكتب (الأدوار الأخرى تقرأ إن امتلكت payments.view).
        $staff = $this->tokenForRole($a['tenant_id'], 'staff', 'staff@pmv-iso-a.test');
        $this->withToken($staff)->putJson("/api/payment-methods/{$mA['id']}", $this->body($mA, ['visual_mode' => 'icon', 'icon_key' => 'wallet']))->assertForbidden();
        $this->withToken($staff)->postJson("/api/payment-methods/{$mA['id']}/logo", ['logo' => UploadedFile::fake()->image('x.png', 40, 40)])->assertForbidden();
        $this->withToken($staff)->deleteJson("/api/payment-methods/{$mA['id']}/logo")->assertForbidden();
    }

    #[Test]
    public function deleting_a_method_removes_its_logo_and_visual_changes_never_touch_financial_fields(): void
    {
        Storage::fake('local');
        $auth = $this->tenant('pmv-del');
        $created = $this->withToken($auth['token'])->postJson('/api/payment-methods', $this->body($this->cashMethod($auth), ['name' => 'محفظة', 'is_default' => false, 'visual_mode' => 'icon', 'icon_key' => 'wallet', 'icon_color' => '#ABCDEF']))->assertCreated();
        $id = $created['data']['id'];
        $this->assertSame('icon', $created['data']['visual_mode']);

        $before = PaymentMethod::findOrFail($id)->only(['settlement_type', 'cash_bank_account_id', 'is_default', 'is_active', 'available_online']);
        $this->withToken($auth['token'])->postJson("/api/payment-methods/{$id}/logo", ['logo' => UploadedFile::fake()->image('l.png', 60, 60)])->assertOk();
        $path = PaymentMethod::findOrFail($id)->logo_path;
        $this->assertSame($before, PaymentMethod::findOrFail($id)->only(['settlement_type', 'cash_bank_account_id', 'is_default', 'is_active', 'available_online']));

        $this->withToken($auth['token'])->deleteJson("/api/payment-methods/{$id}")->assertOk();
        Storage::disk('local')->assertMissing($path);
    }
}
