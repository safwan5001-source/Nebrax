<?php

namespace Tests\Feature;

use App\Models\CommunicationMessage;
use App\Models\CommunicationMessageAttempt;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * AWJ-COMMS-FOUNDATION-02-A — عزل المستأجر عبر مسارات التطبيق المقصودة (النماذج المقيَّدة)، مع تذكير
 * بأن الـGlobal Scope لا يحمي الاستعلامات الخام: ما يلزم إنفاذه يفرضه القيد في القاعدة
 * (انظر CommunicationSchemaTest / CommunicationIdentityProtectionTest).
 */
class CommunicationTenantIsolationTest extends TestCase
{
    use InteractsWithCommunicationSchema;
    use RefreshDatabase;

    /** @return array{0: string, 1: string, 2: string, 3: string, 4: string, 5: string} */
    private function twoTenantsWithRows(): array
    {
        $a = $this->commTenant('a');
        $b = $this->commTenant('b');
        $messageA = $this->insertCommMessage($a->id);
        $messageB = $this->insertCommMessage($b->id);
        $attemptA = $this->insertCommAttempt($a->id, $messageA);
        $attemptB = $this->insertCommAttempt($b->id, $messageB);

        return [$a->id, $b->id, $messageA, $messageB, $attemptA, $attemptB];
    }

    #[Test]
    public function scoped_models_only_read_the_current_tenants_rows(): void
    {
        [$a, $b, $messageA, $messageB, $attemptA, $attemptB] = $this->twoTenantsWithRows();
        app(TenantContext::class)->set($a);

        $this->assertSame([$messageA], CommunicationMessage::query()->pluck('id')->all());
        $this->assertNull(CommunicationMessage::query()->find($messageB));
        $this->assertSame([$attemptA], CommunicationMessageAttempt::query()->pluck('id')->all());
        $this->assertNull(CommunicationMessageAttempt::query()->find($attemptB));
        $this->assertSame(1, CommunicationMessage::query()->findOrFail($messageA)->attempts()->count());

        app(TenantContext::class)->set($b);
        $this->assertSame([$messageB], CommunicationMessage::query()->pluck('id')->all());
    }

    #[Test]
    public function creating_through_the_model_takes_the_tenant_from_context(): void
    {
        $tenant = $this->commTenant();
        app(TenantContext::class)->set($tenant->id);

        $message = CommunicationMessage::create([
            'channel' => 'sms', 'classification' => 'transactional', 'template_key' => 't', 'source' => 's',
            'idempotency_hash' => hash('sha256', 'ctx'), 'recipient_masked' => '+•••12', 'max_attempts' => 3,
            'expires_at' => now()->addHour(), 'next_attempt_at' => now(),
            'payload_encrypted' => ['address' => '+966500000001', 'variables' => []],
        ]);

        $this->assertSame($tenant->id, $message->tenant_id);
    }

    #[Test]
    public function a_cross_tenant_relationship_cannot_be_inserted_through_the_model(): void
    {
        [$a, , , $messageB] = $this->twoTenantsWithRows();
        app(TenantContext::class)->set($a);

        // tenant_id يؤخذ من السياق (A) بينما الرسالة تخص B ⇒ FK المركّبة ترفض.
        $this->commRejects(fn () => CommunicationMessageAttempt::create([
            'message_id' => $messageB, 'attempt_no' => 2, 'provider_key' => 'fake', 'started_at' => now(),
        ]));

        $this->assertSame(1, DB::table('communication_message_attempts')->where('message_id', $messageB)->count());
    }

    #[Test]
    public function application_updates_and_deletes_cannot_touch_another_tenants_rows(): void
    {
        [$a, , , $messageB, , $attemptB] = $this->twoTenantsWithRows();
        app(TenantContext::class)->set($a);
        $before = (array) DB::table('communication_messages')->where('id', $messageB)->first();

        $this->assertSame(0, CommunicationMessage::query()->whereKey($messageB)->update(['last_error_code' => 'cross_tenant']));
        $this->assertSame(0, CommunicationMessage::query()->whereKey($messageB)->delete());
        $this->assertSame(0, CommunicationMessageAttempt::query()->whereKey($attemptB)->update(['error_code' => 'cross_tenant']));
        $this->assertSame(0, CommunicationMessageAttempt::query()->whereKey($attemptB)->delete());

        $this->assertEquals($before, (array) DB::table('communication_messages')->where('id', $messageB)->first());
        $this->assertSame(1, DB::table('communication_message_attempts')->where('id', $attemptB)->count());
    }

    #[Test]
    public function the_tenant_of_a_row_cannot_be_reassigned_to_leak_it_across_tenants(): void
    {
        [$a, $b, $messageA] = $this->twoTenantsWithRows();
        app(TenantContext::class)->set($a);

        $e = $this->commRejects(fn () => CommunicationMessage::query()->whereKey($messageA)->update(['tenant_id' => $b]));
        $this->assertStringContainsString('identity columns are immutable', $e->getMessage());
        $this->assertSame($a, DB::table('communication_messages')->where('id', $messageA)->value('tenant_id'));
    }

    #[Test]
    public function no_application_code_bypasses_the_tenant_scope_for_communications_models(): void
    {
        // القائمة البيضاء فارغة في هذه الشريحة؛ الموزّع/الكنّاس/التقليم اللاحقة تُضاف إليها صراحةً بمراجعة.
        $allowed = [];

        $offenders = [];
        foreach ($this->phpFilesUnder(app_path()) as $file) {
            if ($this->bypassesScopeForCommunications((string) file_get_contents($file)) && ! in_array(basename($file), $allowed, true)) {
                $offenders[] = $file;
            }
        }

        $this->assertSame([], $offenders, 'withoutGlobalScopes on communications models must be explicitly allow-listed');
    }

    #[Test]
    public function the_scope_bypass_scanner_actually_detects_a_violation(): void
    {
        $this->assertTrue($this->bypassesScopeForCommunications('CommunicationMessage::query()->withoutGlobalScopes()->get();'));
        $this->assertTrue($this->bypassesScopeForCommunications("CommunicationMessageAttempt::query()\n    ->withoutGlobalScope(TenantScope::class)"));
        $this->assertFalse($this->bypassesScopeForCommunications('WebhookDelivery::query()->withoutGlobalScopes()->get();'));
        $this->assertFalse($this->bypassesScopeForCommunications('CommunicationMessage::query()->get();'));
    }

    private function bypassesScopeForCommunications(string $source): bool
    {
        return preg_match('/\bCommunicationMessage(Attempt)?\b/', $source) === 1
            && preg_match('/withoutGlobalScope(s)?\b/', $source) === 1;
    }

    /** @return iterable<string> */
    private function phpFilesUnder(string $dir): iterable
    {
        $iterator = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($dir, \FilesystemIterator::SKIP_DOTS));
        foreach ($iterator as $file) {
            if ($file->isFile() && $file->getExtension() === 'php') {
                yield $file->getPathname();
            }
        }
    }
}
