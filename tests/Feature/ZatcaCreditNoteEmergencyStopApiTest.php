<?php

namespace Tests\Feature;

use App\Models\CreditNote;
use App\Models\PlatformAdministrator;
use App\Services\Accounting\ZatcaRolloutControlService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * REM-18b-3d — السياسة B عبر مسار HTTP الحقيقي (`POST /api/credit-notes/{id}/post`): 422 بجسم ثابت `{message, reason}`، ولا أثر محاسبي ولا
 * سلسلي، وتستأنف العملية بعد رفع الإيقاف. الضوابط تُكتب بخدمة المنصة (لا مسار HTTP للمستأجر إليها).
 */
class ZatcaCreditNoteEmergencyStopApiTest extends TestCase
{
    use InteractsWithApi;
    use RefreshDatabase;

    private const MESSAGE = 'الإصدار الإلكتروني للإشعارات الدائنة متوقف مؤقتاً. سيبقى الإشعار مسودة، ويمكن إعادة ترحيله بعد رفع الإيقاف.';

    #[Test]
    public function an_activated_tenant_gets_422_with_a_stable_reason_during_the_stop_and_resumes_after_it(): void
    {
        $auth = $this->registerTenant('stop-api', 'owner@stop-api.test');
        $token = $auth['token'];
        $draft = $this->draftCashNote($token);
        $controls = app(ZatcaRolloutControlService::class);
        $admin = PlatformAdministrator::create([
            'name' => 'مدير منصة', 'email' => Str::random(10).'@platform.test', 'password' => 'secret-password-1', 'is_active' => true,
        ]);
        $controls->setTenantState($admin, $auth['tenant_id'], true, 'تفعيل تجريبي للاختبار');
        $controls->setPlatformState($admin, false, 'إيقاف طارئ للاختبار');

        $this->withToken($token)->postJson("/api/credit-notes/{$draft}/post")
            ->assertStatus(422)
            ->assertExactJson(['message' => self::MESSAGE, 'reason' => 'platform_emergency_stop']);

        $this->assertSame('draft', DB::table('credit_notes')->where('id', $draft)->value('status'));
        $this->assertNull(DB::table('credit_notes')->where('id', $draft)->value('zatca_status'));
        $this->assertSame(0, DB::table('journal_entries')->where('source_type', CreditNote::class)->where('source_id', $draft)->count());
        $this->assertSame(0, DB::table('zatca_chain_entries')->where('credit_note_id', $draft)->count());

        // المسودة قابلة للقراءة وإعادة المحاولة بعد الرفع تنجح وتُصدر.
        $controls->setPlatformState($admin, true, 'رفع الإيقاف');
        $this->withToken($token)->postJson("/api/credit-notes/{$draft}/post")->assertOk();
        $this->assertSame('generated', DB::table('credit_notes')->where('id', $draft)->value('zatca_status'));
        $this->assertSame(1, DB::table('journal_entries')->where('source_type', CreditNote::class)->where('source_id', $draft)->count());
    }

    #[Test]
    public function a_tenant_that_was_never_activated_posts_normally_during_the_stop(): void
    {
        $auth = $this->registerTenant('stop-api-plain', 'owner@stop-api-plain.test');
        $draft = $this->draftCashNote($auth['token']);
        $admin = PlatformAdministrator::create([
            'name' => 'مدير منصة', 'email' => Str::random(10).'@platform.test', 'password' => 'secret-password-1', 'is_active' => true,
        ]);
        app(ZatcaRolloutControlService::class)->setPlatformState($admin, false, 'إيقاف طارئ للاختبار');

        $this->withToken($auth['token'])->postJson("/api/credit-notes/{$draft}/post")->assertOk();

        $this->assertSame('posted', DB::table('credit_notes')->where('id', $draft)->value('status'));
        $this->assertNull(DB::table('credit_notes')->where('id', $draft)->value('zatca_status'));
    }

    private function draftCashNote(string $token): string
    {
        $customer = $this->withToken($token)->postJson('/api/partners', ['name' => 'عميل', 'type' => 'customer'])->assertCreated()['data']['id'];
        $invoice = $this->withToken($token)->postJson('/api/invoices', [
            'partner_id' => $customer, 'payment_type' => 'credit',
            'items' => [['description' => 'خدمة', 'quantity' => 2, 'unit_price' => 10000, 'tax_rate' => 15]],
        ])->assertCreated()['data']['id'];
        $source = $this->withToken($token)->postJson("/api/invoices/{$invoice}/post")->assertOk()['data'];

        return $this->withToken($token)->postJson('/api/credit-notes', [
            'partner_id' => $source['partner_id'], 'original_invoice_id' => $source['id'], 'refund_type' => 'cash',
            'items' => [['source_line_id' => $source['lines'][0]['id'], 'quantity' => 1]],
        ])->assertCreated()['data']['id'];
    }
}
