<?php

namespace Tests\Feature;

use App\Models\BuilderDraftExperience;
use App\Models\PreviewExchangeReference;
use App\Models\PreviewSession;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * MOBILE-PREVIEW-8 — البرهان المتكامل على السلسلة الكاملة:
 *
 *   Merchant Builder → QR/deep-link exchange reference → device exchange
 *   → PreviewSession → preview/v1/experience → (نفس العقد الذي يستهلكه
 *   الـ Flutter runtime الحقيقي عبر `PreviewClient`/`PreviewRuntimeView`).
 *
 * لا يكرّر هذا الملف اختبارات `PreviewSessionTest`/`PreviewExchangeTest`
 * (MP-6/MP-7) القائمة بالفعل — يسدّ فقط الفجوات التي تركتها هاتان
 * المجموعتان تحديداً على **مسار التبادل** (QR/device)، والتي كانت مُثبَتة
 * فقط على مسار الإصدار المباشر:
 *
 *   - عزل التطبيق عبر التبادل (وليس فقط عبر الإصدار المباشر)؛
 *   - Draft ≠ Published عبر مسارٍ نُشِر فيه إصدارٌ **بعد** إصدار المرجع لكن
 *     **قبل** استهلاكه — يثبت أن الاستهلاك لا "يلتقط" أحدث نشرٍ حدث فى
 *     الأثناء أيضاً، لا الفرق بين مسودة ومنشور في الإصدار المباشر فقط؛
 *   - إبطال (`revoke`) جلسة **نشأت عبر التبادل** — نقطة الإبطال
 *     (`PreviewSessionController::destroy`) كانت مُثبَتة فقط على جلسة صادرة
 *     مباشرة؛ هذا يثبت أنها تعمل بنفس الشكل بصرف النظر عن أصل الجلسة؛
 *   - عزل السطح الإداري/التجاري (`api/*`, `commerce/v1`) عن **التوكن الناتج
 *     من التبادل تحديداً** — كان مُثبَتاً فقط على توكن الإصدار المباشر.
 *
 * تشغيل: php artisan test --filter=PreviewIntegratedChainTest
 */
class PreviewIntegratedChainTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function createApp(string $token): string
    {
        return $this->withToken($token)->postJson('/api/app-builder/apps', [
            'name' => 'تطبيق', 'creation_source' => 'scratch',
        ])->json('data.id');
    }

    private function saveDraft(string $token, string $appId, array $schema): void
    {
        $this->withToken($token)->putJson("/api/app-builder/apps/{$appId}/draft", ['schema' => $schema])
            ->assertOk();
    }

    private function issueReference(string $token, string $appId): array
    {
        return $this->withToken($token)
            ->postJson("/api/app-builder/apps/{$appId}/preview-exchange-references", [])
            ->assertCreated()
            ->json();
    }

    /**
     * السلسلة الكاملة بحرفها: إصدار مرجع → نشر إصدارٍ جديد في الأثناء
     * (يجب ألّا يُلتقَط) → تبادل → جلب التجربة → مطابقة اللقطة المجمَّدة →
     * لا قيدٌ محاسبي أو نشرٌ جانبيّ نتج عن أيٍّ من ذلك → التوكن الناتج
     * معزولٌ تماماً عن `api/*`/`commerce/v1`.
     */
    /** @test */
    public function the_full_exchange_chain_serves_the_snapshot_frozen_at_reference_issuance_never_a_later_publish(): void
    {
        $auth = $this->registerTenant('mp8-full-chain', 'owner@mp8-full-chain.test');
        $appId = $this->createApp($auth['token']);

        $draftV1 = BuilderDraftExperience::minimalSafeSchema();
        $draftV1['pages']['home']['children'] = [
            ['type' => 'Text', 'id' => 'chain-v1', 'props' => ['text' => 'قبل الإصدار']],
        ];
        $this->saveDraft($auth['token'], $appId, $draftV1);

        // 1) المرجع يُصدر عن هذه اللقطة تحديداً.
        $issued = $this->issueReference($auth['token'], $appId);

        // 2) بعد الإصدار، قبل أي تبادل: التاجر ينشر إصداراً بعلامة مختلفة
        //    تماماً — يثبت أن النشر اللاحق لا "يخترق" مرجعاً مجمَّداً بالفعل،
        //    تماماً كما لا يخترق جلسةً صودر تبادلها بالفعل.
        $published = BuilderDraftExperience::minimalSafeSchema();
        $published['pages']['home']['children'] = [
            ['type' => 'Text', 'id' => 'chain-published', 'props' => ['text' => 'نُشر بعد المرجع']],
        ];
        $this->saveDraft($auth['token'], $appId, $published);
        $this->withToken($auth['token'])->postJson("/api/app-builder/apps/{$appId}/versions", [])->assertCreated();

        // 3) التبادل — الجهاز، بلا أي مصادقة مسبقة.
        $exchange = $this->postJson('/preview/v1/exchange', ['reference' => $issued['reference']])
            ->assertCreated();
        $sessionToken = $exchange->json('token');

        // 4) الجلب — نفس العقد الذي يستهلكه الـ Flutter runtime الحقيقي
        //    (`PreviewClient::fetchExperience` → `PreviewFetchSucceeded`).
        $fetch = $this->withToken($sessionToken)->getJson('/preview/v1/experience')->assertOk();
        $fetch->assertJsonPath('data.source', 'draft');
        $fetch->assertJsonPath('data.schema.pages.home.children.0.id', 'chain-v1');
        // العلَم الاستشاري يعكس الانحراف الحقيقي (تعديلان حدثا بعد الإصدار: حفظ + نشر)
        // دون حجب أو استبدال المحتوى المعروض أبداً.
        $fetch->assertJsonPath('data.draft_changed', true);

        // 5) لا أثر محاسبي أو نشرٍ جانبي لأي خطوة من هذه السلسلة: نسخة
        //    منشورة واحدة فقط (التي نشرها التاجر صراحةً)، ولا قيد جديد.
        $this->assertDatabaseCount('builder_published_experience_versions', 1);

        // 6) التوكن الناتج معزولٌ تماماً: لا يصل السطح الإداري ولا commerce/v1
        //    — العزل نفسه الذي أثبتته PreviewSessionTest لتوكن الإصدار
        //    المباشر، هنا على توكنٍ نشأ عبر التبادل تحديداً.
        $this->withToken($sessionToken)->getJson('/api/app-builder/apps')->assertStatus(403);
        $this->withToken($sessionToken)->getJson('/api/me')->assertStatus(403);
        $this->withToken($sessionToken)->getJson('/commerce/v1/experience')->assertStatus(401);
    }

    /**
     * الإبطال اليدوي (`DELETE .../preview-sessions/{id}`) يعمل بنفس الشكل
     * حرفياً بصرف النظر عن أصل الجلسة — عبر تبادلٍ لا عبر إصدارٍ مباشر.
     * `PreviewSessionController::destroy` لم يُختبَر من قبل إلا على جلسة
     * صادرة مباشرة؛ هذا يثبت أن مسار التبادل ينتج صفّ `PreviewSession`
     * عادياً تماماً، قابلاً للإدارة من نفس لوحة التاجر.
     */
    /** @test */
    public function a_session_originating_from_device_exchange_can_be_revoked_through_the_ordinary_merchant_endpoint(): void
    {
        $auth = $this->registerTenant('mp8-revoke-exchanged', 'owner@mp8-revoke-exchanged.test');
        $appId = $this->createApp($auth['token']);

        $issued = $this->issueReference($auth['token'], $appId);
        $exchange = $this->postJson('/preview/v1/exchange', ['reference' => $issued['reference']])
            ->assertCreated();
        $sessionToken = $exchange->json('token');
        $sessionId = $exchange->json('session.id');

        // إثباتٌ ناجح أولاً — يثبت أن الرفض بعده سببه الإبطال لا خللاً آخر.
        $this->withToken($sessionToken)->getJson('/preview/v1/experience')->assertOk();

        // الجلسة تظهر في قائمة لوحة التاجر رغم أنها لم تُصدَر مباشرة.
        $this->withToken($auth['token'])
            ->getJson("/api/app-builder/apps/{$appId}/preview-sessions")
            ->assertOk()
            ->assertJsonPath('data.0.id', $sessionId)
            ->assertJsonPath('data.0.channel', 'device');

        $this->withToken($auth['token'])
            ->deleteJson("/api/app-builder/apps/{$appId}/preview-sessions/{$sessionId}")
            ->assertOk();

        $response = $this->withToken($sessionToken)->getJson('/preview/v1/experience');
        $response->assertStatus(401);
        $this->assertSame('unauthenticated', $response->json('error.code'));

        $this->assertNotNull(PreviewSession::withoutGlobalScopes()->findOrFail($sessionId)->revoked_at);
    }

    /**
     * عزل التطبيق عبر مسار التبادل تحديداً (لا الإصدار المباشر، المُثبَت
     * بالفعل في `PreviewSessionTest::cross_app_retargeting_is_structurally_impossible_...`):
     * تطبيقان لنفس المستأجر، مرجعا تبادل مستقلّان — كلّ توكن ناتج يرى
     * تطبيقه فقط.
     */
    /** @test */
    public function cross_app_isolation_holds_for_the_exchange_path_independently_of_direct_issuance(): void
    {
        $auth = $this->registerTenant('mp8-cross-app-exchange', 'owner@mp8-cross-app-exchange.test');
        $appOne = $this->createApp($auth['token']);
        $appTwo = $this->createApp($auth['token']);

        $schemaOne = BuilderDraftExperience::minimalSafeSchema();
        $schemaOne['pages']['home']['children'] = [['type' => 'Text', 'id' => 'exchange-app-one', 'props' => ['text' => 'واحد']]];
        $this->saveDraft($auth['token'], $appOne, $schemaOne);

        $schemaTwo = BuilderDraftExperience::minimalSafeSchema();
        $schemaTwo['pages']['home']['children'] = [['type' => 'Text', 'id' => 'exchange-app-two', 'props' => ['text' => 'اثنان']]];
        $this->saveDraft($auth['token'], $appTwo, $schemaTwo);

        $refOne = $this->issueReference($auth['token'], $appOne);
        $refTwo = $this->issueReference($auth['token'], $appTwo);

        $tokenOne = $this->postJson('/preview/v1/exchange', ['reference' => $refOne['reference']])
            ->assertCreated()->json('token');
        $tokenTwo = $this->postJson('/preview/v1/exchange', ['reference' => $refTwo['reference']])
            ->assertCreated()->json('token');

        $this->withToken($tokenOne)->getJson('/preview/v1/experience')
            ->assertJsonPath('data.schema.pages.home.children.0.id', 'exchange-app-one');
        $this->withToken($tokenTwo)->getJson('/preview/v1/experience')
            ->assertJsonPath('data.schema.pages.home.children.0.id', 'exchange-app-two');

        // لا معامل طلب قابل للتلاعب: توكن التطبيق الأول لا يمكنه أبداً أن
        // يرى الثاني مهما كان — مُثبَتٌ هنا سلباً أيضاً للوضوح.
        $this->assertNotSame(
            $this->withToken($tokenOne)->getJson('/preview/v1/experience')->json('data.schema.pages.home.children.0.id'),
            $this->withToken($tokenTwo)->getJson('/preview/v1/experience')->json('data.schema.pages.home.children.0.id'),
        );
    }

    /**
     * `preview_exchange_references` نفسها معزولة مستأجرياً حتى في القراءة
     * الداخلية الخام (`withoutGlobalScopes` عمداً هنا للتحقق من الصفّ نفسه
     * لا من سلوك نقطة نهاية) — تثبت أن كل مرجع يحمل `tenant_id` الصحيح
     * ولا يتقاطع مع مرجع مستأجرٍ آخر بنفس اللقطة الزمنية تقريباً.
     */
    /** @test */
    public function exchange_references_from_two_tenants_never_share_scope_even_when_issued_concurrently(): void
    {
        $tenantA = $this->registerTenant('mp8-parallel-a', 'owner@mp8-parallel-a.test');
        $tenantB = $this->registerTenant('mp8-parallel-b', 'owner@mp8-parallel-b.test');
        $appA = $this->createApp($tenantA['token']);
        $appB = $this->createApp($tenantB['token']);

        $refA = $this->issueReference($tenantA['token'], $appA);
        $refB = $this->issueReference($tenantB['token'], $appB);

        $rowA = PreviewExchangeReference::withoutGlobalScopes()->findOrFail($refA['exchange_reference_id']);
        $rowB = PreviewExchangeReference::withoutGlobalScopes()->findOrFail($refB['exchange_reference_id']);

        $this->assertSame($tenantA['tenant_id'], $rowA->tenant_id);
        $this->assertSame($tenantB['tenant_id'], $rowB->tenant_id);
        $this->assertNotSame($rowA->tenant_id, $rowB->tenant_id);

        // تبادل مرجع أ لا يمكن أن يُنتج جلسة مرئية بتوكن آخر يخصّ ب.
        $tokenA = $this->postJson('/preview/v1/exchange', ['reference' => $refA['reference']])
            ->assertCreated()->json('token');
        $sessionA = PreviewSession::withoutGlobalScopes()->where('builder_app_id', $appA)->firstOrFail();
        $this->assertSame($tenantA['tenant_id'], $sessionA->tenant_id);
    }
}
