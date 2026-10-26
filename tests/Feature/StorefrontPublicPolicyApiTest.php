<?php

namespace Tests\Feature;

use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Support\Commerce\PolicyMarkdownRenderer;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * B8-2 — GET store/v1/policies/{slug}: عقد، منشور فقط، لغات، XSS، عزل (مستأجر/متجر/Host).
 *
 * تشغيل: php artisan test --filter=StorefrontPublicPolicyApiTest
 */
class StorefrontPublicPolicyApiTest extends TestCase
{
    use InteractsWithApi;
    use RefreshDatabase;

    private function ws(string $id): string
    {
        return '/api/commerce/workspace/storefronts/'.$id.'/presentation';
    }

    /** @return array{storefront: Storefront} */
    private function seedStore(string $tenantId, string $host, string $slug = 'main', string $locale = 'ar'): array
    {
        app(TenantContext::class)->set($tenantId);
        $channel = SalesChannel::query()->where('slug', 'web')->first()
            ?? SalesChannel::create(['slug' => 'web', 'name' => 'ويب', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
        $storefront = Storefront::create([
            'slug' => $slug, 'name' => 'متجر '.$slug, 'sales_channel_id' => $channel->id,
            'is_active' => true, 'default_locale' => $locale,
        ]);
        StorefrontDomain::create([
            'storefront_id' => $storefront->id, 'hostname' => $host, 'type' => StorefrontDomain::TYPE_CUSTOM,
            'is_primary' => true, 'is_active' => true, 'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
        ]);
        app(TenantContext::class)->forget();

        return compact('storefront');
    }

    /** @param array<string, mixed> $content */
    private function page(string $slug, array $content, bool $enabled = true, string $title = 'عنوان قديم'): array
    {
        return ['id' => 'p-'.$slug, 'slug' => $slug, 'title' => $title, 'enabled' => $enabled, 'content' => $content];
    }

    private function save(array $auth, Storefront $sf, array $pages, int $rev = 0, bool $publish = true): void
    {
        $this->withToken($auth['token'])->putJson($this->ws($sf->id), ['config' => ['pages' => $pages], 'draft_revision' => $rev])->assertOk();
        if ($publish) {
            $this->withToken($auth['token'])->postJson($this->ws($sf->id).'/publish')->assertOk();
        }
    }

    /** @test */
    public function published_enabled_policy_returns_the_contract_with_no_store(): void
    {
        $a = $this->registerTenant('pp-a', 'owner@pp-a.test');
        $s = $this->seedStore($a['tenant_id'], 'pp-a.example.com');
        $this->save($a, $s['storefront'], [$this->page('privacy-policy', ['ar' => ['title' => 'الخصوصية', 'body' => "## بيانات\n\nنص **مهم**"], 'en' => ['title' => 'Privacy', 'body' => 'English']])]);

        $res = $this->getJson('http://pp-a.example.com/store/v1/policies/privacy-policy')->assertOk();
        $this->assertSame('privacy-policy', $res->json('data.slug'));
        $this->assertSame('ar', $res->json('data.locale'));
        $this->assertFalse($res->json('data.fallback'));
        $this->assertSame('الخصوصية', $res->json('data.title'));
        $this->assertSame("<h2>بيانات</h2>\n<p>نص <strong>مهم</strong></p>", $res->json('data.html'));
        $this->assertNotEmpty($res->json('meta.request_id'));
        $this->assertStringContainsString('no-store', (string) $res->headers->get('Cache-Control'));
        $this->assertSame('nosniff', $res->headers->get('X-Content-Type-Options'));
        $this->assertEqualsCanonicalizing(['slug', 'locale', 'fallback', 'title', 'html'], array_keys($res->json('data')));
    }

    /** @test */
    public function unknown_disabled_unpublished_draft_only_and_empty_policies_are_one_uniform_404(): void
    {
        $a = $this->registerTenant('pp-404', 'owner@pp-404.test');
        $s = $this->seedStore($a['tenant_id'], 'pp-404.example.com');
        $host = 'http://pp-404.example.com/store/v1/policies/';

        // غير منشور أصلاً.
        $this->save($a, $s['storefront'], [$this->page('returns-policy', ['ar' => ['title' => 't', 'body' => 'نص']])], 0, false);
        $unpublished = $this->getJson($host.'returns-policy')->assertNotFound();

        // نشر ثم مسودة أحدث لا تُقرأ.
        $this->withToken($a['token'])->postJson($this->ws($s['storefront']->id).'/publish')->assertOk();
        $this->getJson($host.'returns-policy')->assertOk();
        $this->withToken($a['token'])->putJson($this->ws($s['storefront']->id), ['config' => ['pages' => [
            $this->page('returns-policy', ['ar' => ['title' => 't', 'body' => 'مسودة سرية']]),
            $this->page('terms-of-service', ['ar' => ['title' => 't', 'body' => 'x']], false),
            $this->page('shipping-policy', ['ar' => ['title' => ' ', 'body' => '   ']]),
        ]], 'draft_revision' => $this->withToken($a['token'])->getJson($this->ws($s['storefront']->id))->json('data.draft_revision')])->assertOk();
        $this->assertStringNotContainsString('مسودة سرية', $this->getJson($host.'returns-policy')->getContent());

        $this->save($a, $s['storefront'], [
            $this->page('returns-policy', ['ar' => ['title' => 't', 'body' => 'نص']], false),
            $this->page('terms-of-service', ['ar' => ['title' => 't', 'body' => 'x']], false),
            $this->page('shipping-policy', ['ar' => ['title' => ' ', 'body' => '   ']]),
        ], $this->withToken($a['token'])->getJson($this->ws($s['storefront']->id))->json('data.draft_revision'));

        $bodies = [];
        foreach (['returns-policy', 'terms-of-service', 'shipping-policy', 'privacy-policy', 'about', 'unknown', '%2e%2e', 'PRIVACY-POLICY'] as $slug) {
            $r = $this->getJson($host.$slug)->assertNotFound();
            $this->assertSame('not_found', $r->json('error.code'));
            $this->assertStringContainsString('no-store', (string) $r->headers->get('Cache-Control'), $slug);
            $bodies[] = $r->json('error');
        }
        $this->assertCount(1, array_unique(array_map('json_encode', $bodies)));
        // شكل لا يطابق المسار أصلاً (فاصل مُرمَّز) ⇒ 404 إطار عام بلا بيانات.
        $this->getJson($host.'a%2Fb')->assertNotFound();
        $this->assertSame($bodies[0], $unpublished->json('error'));
    }

    /** @test */
    public function locale_selection_and_deterministic_fallback(): void
    {
        $a = $this->registerTenant('pp-loc', 'owner@pp-loc.test');
        $s = $this->seedStore($a['tenant_id'], 'pp-loc.example.com', 'main', 'en');
        $this->save($a, $s['storefront'], [
            $this->page('privacy-policy', ['ar' => ['title' => 'ع', 'body' => 'عربي'], 'en' => ['title' => 'E', 'body' => 'English']]),
            $this->page('terms-of-service', ['ar' => ['title' => 'ع', 'body' => 'عربي فقط']]),
            $this->page('returns-policy', ['en' => ['title' => '', 'body' => 'English only']], true, 'Legacy title'),
        ]);
        $u = 'http://pp-loc.example.com/store/v1/policies/';

        $r = $this->getJson($u.'privacy-policy?locale=ar')->assertOk();
        $this->assertSame(['ar', false], [$r->json('data.locale'), $r->json('data.fallback')]);
        $r = $this->getJson($u.'privacy-policy?locale=en')->assertOk();
        $this->assertSame(['en', false], [$r->json('data.locale'), $r->json('data.fallback')]);
        // بلا طلب ⇒ لغة المتجر (en)، وليس fallback.
        $r = $this->getJson($u.'privacy-policy')->assertOk();
        $this->assertSame(['en', false], [$r->json('data.locale'), $r->json('data.fallback')]);
        // لغة غير مدعومة تُتجاهل.
        $this->assertSame('en', $this->getJson($u.'privacy-policy?locale=fr')->json('data.locale'));
        $this->assertSame('en', $this->getJson($u.'privacy-policy?locale[]=ar')->json('data.locale'));
        // المطلوبة مفقودة ⇒ بديل محدد + fallback=true.
        $r = $this->getJson($u.'terms-of-service?locale=en')->assertOk();
        $this->assertSame(['ar', true], [$r->json('data.locale'), $r->json('data.fallback')]);
        $r = $this->getJson($u.'returns-policy?locale=ar')->assertOk();
        $this->assertSame(['en', true, 'Legacy title'], [$r->json('data.locale'), $r->json('data.fallback'), $r->json('data.title')]);
    }

    /** @test */
    public function general_storefront_response_never_carries_policy_bodies(): void
    {
        $a = $this->registerTenant('pp-conf', 'owner@pp-conf.test');
        $s = $this->seedStore($a['tenant_id'], 'pp-conf.example.com');
        $this->save($a, $s['storefront'], [$this->page('privacy-policy', ['ar' => ['title' => 't', 'body' => 'BODY-CONF-1']])]);

        $this->assertStringNotContainsString('BODY-CONF-1', $this->getJson('http://pp-conf.example.com/store/v1/storefront')->assertOk()->getContent());
        $this->assertStringContainsString('BODY-CONF-1', $this->getJson('http://pp-conf.example.com/store/v1/policies/privacy-policy')->getContent());
    }

    /** @test */
    public function tenant_storefront_isolation_and_host_spoofing(): void
    {
        $a = $this->registerTenant('pp-iso-a', 'owner@pp-iso-a.test');
        $b = $this->registerTenant('pp-iso-b', 'owner@pp-iso-b.test');
        $sa1 = $this->seedStore($a['tenant_id'], 'iso-a1.example.com', 'one');
        $sa2 = $this->seedStore($a['tenant_id'], 'iso-a2.example.com', 'two');
        $sb = $this->seedStore($b['tenant_id'], 'iso-b.example.com');
        $this->save($a, $sa1['storefront'], [$this->page('privacy-policy', ['ar' => ['title' => 'a1', 'body' => 'SECRET-A1']])]);
        $this->save($b, $sb['storefront'], [$this->page('privacy-policy', ['ar' => ['title' => 'b', 'body' => 'SECRET-B']])]);

        $p = '/store/v1/policies/privacy-policy';
        $this->assertSame('a1', $this->getJson('http://iso-a1.example.com'.$p)->json('data.title'));
        $this->assertSame('b', $this->getJson('http://iso-b.example.com'.$p)->json('data.title'));
        // متجران لنفس المستأجر: الثاني لا يرى نص الأول.
        $r = $this->getJson('http://iso-a2.example.com'.$p)->assertNotFound();
        $this->assertStringNotContainsString('SECRET', $r->getContent());

        // انتحال: ترويسات/معاملات الهوية لا تغيّر النتيجة (الحسم من Host فقط).
        $spoof = $this->withHeaders([
            'X-Forwarded-Host' => 'iso-b.example.com', 'X-Original-Host' => 'iso-b.example.com', 'Forwarded' => 'host=iso-b.example.com',
            'X-Tenant-ID' => $b['tenant_id'], 'X-Storefront-ID' => $sb['storefront']->id,
        ])->getJson('http://iso-a2.example.com'.$p.'?tenant_id='.$b['tenant_id'].'&storefront_id='.$sb['storefront']->id.'&host=iso-b.example.com');
        $spoof->assertNotFound();
        $this->assertStringNotContainsString('SECRET', $spoof->getContent());

        $spoof2 = $this->withHeaders(['X-Forwarded-Host' => 'iso-a1.example.com'])->getJson('http://iso-b.example.com'.$p);
        $this->assertSame('b', $spoof2->json('data.title'));

        // مضيف غير مسجَّل ⇒ 404 بلا نص.
        $this->getJson('http://unknown.example.com'.$p)->assertNotFound();
    }

    /** @return array<string, array{string}> */
    public static function attackCorpus(): array
    {
        return [
            'script tag' => ['<script>alert(1)</script>'],
            'img onerror' => ['<img src=x onerror=alert(1)>'],
            'svg onload' => ['<svg onload=alert(1)>'],
            'iframe' => ['<iframe src="https://evil.test"></iframe>'],
            'js link' => ['[x](javascript:alert(1))'],
            'js link mixed case' => ['[x](JaVaScRiPt:alert(1))'],
            'js link entity' => ['[x](&#106;avascript:alert(1))'],
            'js link hex entity' => ['[x](&#x6A;avascript:alert(1))'],
            'js link tab' => ["[x](java\tscript:alert(1))"],
            'js link newline' => ["<a href=\"java\nscript:alert(1)\">x</a>"],
            'data link' => ['[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)'],
            'vbscript' => ['[x](vbscript:msgbox(1))'],
            'file link' => ['[x](file:///etc/passwd)'],
            'raw anchor onclick' => ['<a href="https://ok.test" onclick="alert(1)">x</a>'],
            'style attr' => ['<p style="background:url(javascript:alert(1))">x</p>'],
            'srcdoc' => ['<iframe srcdoc="<script>alert(1)</script>"></iframe>'],
            'comment' => ['<!-- <script>alert(1)</script> -->'],
            'cdata' => ['<![CDATA[<script>alert(1)</script>]]>'],
            'entity encoded tag' => ['&lt;script&gt;alert(1)&lt;/script&gt;'],
            'double encoded' => ['&amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;'],
            'form' => ['<form action="https://evil.test"><input name=x></form>'],
            'object' => ['<object data="javascript:alert(1)"></object>'],
            'meta refresh' => ['<meta http-equiv="refresh" content="0;url=javascript:alert(1)">'],
            'math' => ['<math><mi xlink:href="javascript:alert(1)">x</mi></math>'],
            'image md' => ['![x](javascript:alert(1))'],
            'image md https' => ['![x](https://evil.test/a.png)'],
            'autolink js' => ['<javascript:alert(1)>'],
            'ref link' => ["[x][r]\n\n[r]: javascript:alert(1)"],
            'nested broken' => ['<<script>script>alert(1)<</script>/script>'],
            'event on heading' => ['<h2 onmouseover=alert(1)>x</h2>'],
        ];
    }

    /**
     * @test
     * @dataProvider attackCorpus
     */
    public function attack_corpus_never_yields_executable_html(string $payload): void
    {
        $html = PolicyMarkdownRenderer::render($payload);
        $this->assertNoActiveContent($html);
        // وعلى مرشّح DOM وحده (دفاع ثانٍ) حتى لو تجاوز HTML الخام الطبقة الأولى.
        $this->assertNoActiveContent(PolicyMarkdownRenderer::sanitize($payload));
    }

    private function assertNoActiveContent(string $html): void
    {
        $this->assertDoesNotMatchRegularExpression('/<\s*(script|iframe|svg|img|object|embed|form|input|meta|math|style|link|base)\b/i', $html);
        $this->assertDoesNotMatchRegularExpression('/\son[a-z]+\s*=/i', $html);
        $this->assertDoesNotMatchRegularExpression('/\s(style|srcdoc|src|formaction|xlink:href)\s*=/i', $html);
        $this->assertDoesNotMatchRegularExpression('/href\s*=\s*"\s*(?!https:|mailto:|tel:)/i', $html);
    }

    /** @test */
    public function renderer_keeps_safe_formatting_and_rewrites_links(): void
    {
        $html = PolicyMarkdownRenderer::render("# عنوان\n\n- بند **عريض** و*مائل*\n\n> اقتباس\n\n[ضريبة](https://example.com/vat) [بريد](mailto:a@b.test) [هاتف](tel:+966500000000)\n\nسطر<br>جديد");
        $this->assertStringContainsString('<h2>عنوان</h2>', $html);
        $this->assertStringContainsString('<li>بند <strong>عريض</strong> و<em>مائل</em></li>', $html);
        $this->assertStringContainsString('<blockquote>', $html);
        $this->assertStringContainsString('<a href="https://example.com/vat" rel="noopener nofollow ugc">ضريبة</a>', $html);
        $this->assertStringContainsString('href="mailto:a@b.test"', $html);
        $this->assertStringContainsString('href="tel:+966500000000"', $html);
        // http غير آمن ونسبي بلا مخطط يُنزعان (يبقى النص).
        $plain = PolicyMarkdownRenderer::render('[a](http://x.test) [b](/relative) [c](//proto.test)');
        $this->assertStringNotContainsString('href', $plain);
        $this->assertStringContainsString('a', strip_tags($plain));
        $this->assertSame('', PolicyMarkdownRenderer::render("   \n"));
    }
}
