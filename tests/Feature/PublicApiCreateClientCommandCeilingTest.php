<?php

namespace Tests\Feature;

use App\Models\ApiClient;
use App\Models\Role;
use App\Models\User;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\PersonalAccessToken;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * AIA-0.4 / D-08 — أمر `public-api:create-client`: سياسة A (`--issuer` إلزامي مع سقف صلاحيات).
 *
 *  - بلا `--issuer` ⇒ فشل (لا مسار قديم غير مقيَّد — C مرفوض).
 *  - مُصدِر غير موجود/معطَّل/من مستأجر آخر ⇒ فشل.
 *  - مُصدِر بلا الصلاحية المقابلة ⇒ فشل **قبل** إنشاء أي عميل أو مفتاح.
 *  - مُصدِر مخوَّل ⇒ ينجح ويطبع السرّ مرة واحدة.
 *  - لا استثناء إداري (B مؤجَّل): خيار `--operator` غير موجود.
 *
 * صارمة بلا skip/incomplete (يحرسها `PublicApiScopeCeilingArchitectureTest`).
 */
#[Group('aia-0-4-security')]
class PublicApiCreateClientCommandCeilingTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function setUpTenant(string $slug = 'acme'): array
    {
        $owner = $this->registerTenant($slug, "owner@{$slug}.test");
        app(TenantContext::class)->set($owner['tenant_id']);
        Role::create(['tenant_id' => $owner['tenant_id'], 'slug' => 'dev_limited', 'name' => 'L', 'permissions' => ['developer.view', 'developer.manage']]);
        Role::create(['tenant_id' => $owner['tenant_id'], 'slug' => 'dev_reader', 'name' => 'R', 'permissions' => ['developer.view', 'developer.manage', 'partners.view', 'reports.view']]);
        app(TenantContext::class)->forget();
        $this->tokenForRole($owner['tenant_id'], 'dev_limited', "limited@{$slug}.test");
        $this->tokenForRole($owner['tenant_id'], 'dev_reader', "reader@{$slug}.test");
        app(TenantContext::class)->forget();

        return ['slug' => $slug, 'tenant_id' => $owner['tenant_id'], 'owner' => "owner@{$slug}.test"];
    }

    /** @return array{clients:int,tokens:int} */
    private function footprint(): array
    {
        return ['clients' => ApiClient::withoutGlobalScopes()->count(), 'tokens' => PersonalAccessToken::query()->count()];
    }

    private function createClient(array $args): \Illuminate\Testing\PendingCommand
    {
        return $this->artisan('public-api:create-client', $args);
    }

    #[Test]
    public function without_an_issuer_the_command_fails_and_creates_nothing(): void
    {
        $t = $this->setUpTenant();
        $before = $this->footprint();

        $this->createClient(['tenant' => $t['slug'], 'name' => 'x', '--scopes' => 'partners:read'])
            ->expectsOutputToContain('--issuer')
            ->assertExitCode(1);

        $this->assertSame($before, $this->footprint());
    }

    #[Test]
    public function an_unknown_inactive_or_foreign_issuer_is_rejected(): void
    {
        $t = $this->setUpTenant('acme');
        $other = $this->setUpTenant('beta');
        User::query()->where('email', 'reader@acme.test')->update(['is_active' => false]);
        $before = $this->footprint();

        foreach (['nobody@acme.test', 'reader@acme.test', 'owner@beta.test'] as $issuer) {
            $this->createClient(['tenant' => $t['slug'], 'name' => 'x', '--scopes' => 'partners:read', '--issuer' => $issuer])
                ->assertExitCode(1);
        }

        $this->assertSame($before, $this->footprint());
    }

    #[Test]
    public function an_issuer_without_the_matching_permission_is_rejected_before_anything_is_created(): void
    {
        $t = $this->setUpTenant();
        $before = $this->footprint();

        $this->createClient(['tenant' => $t['slug'], 'name' => 'x', '--scopes' => 'statements:read', '--issuer' => 'limited@acme.test'])
            ->expectsOutputToContain('statements:read')
            ->assertExitCode(1);

        // خليط: partners:read مسموح للقارئ (partners.view) وinvoices:write ممنوع ⇒ رفض كامل.
        $this->createClient(['tenant' => $t['slug'], 'name' => 'x', '--scopes' => 'partners:read,invoices:write', '--issuer' => 'reader@acme.test'])
            ->expectsOutputToContain('invoices:write')
            ->assertExitCode(1);

        $this->assertSame($before, $this->footprint(), 'لا عميل ولا مفتاح عند الرفض.');
    }

    #[Test]
    public function an_authorised_issuer_succeeds_and_the_owner_can_issue_any_scope(): void
    {
        $t = $this->setUpTenant();
        $before = $this->footprint();

        $this->createClient(['tenant' => $t['slug'], 'name' => 'ok-reader', '--scopes' => 'partners:read,statements:read', '--issuer' => 'READER@acme.test'])
            ->expectsOutputToContain('issuer')
            ->assertExitCode(0);
        $this->createClient(['tenant' => $t['slug'], 'name' => 'ok-owner', '--scopes' => 'invoices:write,webhooks:write', '--issuer' => $t['owner']])
            ->assertExitCode(0);

        $after = $this->footprint();
        $this->assertSame($before['clients'] + 2, $after['clients']);
        $this->assertSame($before['tokens'] + 2, $after['tokens']);
    }

    #[Test]
    public function the_issuer_can_also_be_given_by_uuid(): void
    {
        $t = $this->setUpTenant();
        $id = User::query()->where('email', 'reader@acme.test')->value('id');

        $this->createClient(['tenant' => $t['slug'], 'name' => 'by-id', '--scopes' => 'partners:read', '--issuer' => $id])->assertExitCode(0);
    }

    #[Test]
    public function there_is_no_operator_bypass_option(): void
    {
        $t = $this->setUpTenant();
        $before = $this->footprint();

        $this->expectException(\Symfony\Component\Console\Exception\InvalidOptionException::class);
        try {
            $this->createClient(['tenant' => $t['slug'], 'name' => 'x', '--scopes' => 'statements:read', '--operator' => true])->run();
        } finally {
            $this->assertSame($before, $this->footprint());
        }
    }
}
