<?php

namespace Tests\Feature;

use App\Models\BuilderDraftExperience;
use App\Models\BuilderPublishedExperienceVersion;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * AD-01 (S01d / G1) — حماية نشر المسودة من التعارض: `expected_draft_revision` اختياري (متوافق مع
 * المستهلكين الحاليين)؛ إن أُرسل ولم يطابق revision المسودة داخل القفل ⇒ 409 `draft_changed_since_review`
 * بلا إنشاء نسخة. كل نسخة منشورة تسجّل `source_draft_revision`. التزامن الحقيقي في
 * `BuilderPublishConcurrencyPostgresTest`.
 *
 * تشغيل: php artisan test --filter=BuilderPublishExpectedRevisionTest
 */
class BuilderPublishExpectedRevisionTest extends TestCase
{
    use InteractsWithApi;
    use RefreshDatabase;

    /** @return array{0: array<string, mixed>, 1: string} */
    private function newApp(string $slug): array
    {
        $auth = $this->registerTenant($slug, "owner@{$slug}.test");
        $appId = $this->withToken($auth['token'])->postJson('/api/app-builder/apps', [
            'name' => 'تطبيق', 'creation_source' => 'scratch',
        ])->json('data.id');

        return [$auth, $appId];
    }

    private function schema(string $marker): array
    {
        $schema = BuilderDraftExperience::minimalSafeSchema();
        $schema['pages']['home']['children'] = [['type' => 'Text', 'id' => 'home-text', 'props' => ['text' => $marker]]];

        return $schema;
    }

    private function save(string $token, string $appId, string $marker): int
    {
        return (int) $this->withToken($token)->putJson("/api/app-builder/apps/{$appId}/draft", $this->builderDraftBody($appId, $this->schema($marker)))
            ->assertOk()->json('data.revision');
    }

    private function publish(string $token, string $appId, array $body = [])
    {
        return $this->withToken($token)->postJson("/api/app-builder/apps/{$appId}/versions", $body);
    }

    /** @test */
    public function publishing_with_the_current_expected_revision_succeeds_and_records_the_source_revision(): void
    {
        [$auth, $appId] = $this->newApp('ad01-pub-ok');
        $revision = $this->save($auth['token'], $appId, 'للنشر');

        $this->publish($auth['token'], $appId, ['expected_draft_revision' => $revision])
            ->assertCreated()
            ->assertJsonPath('data.source_draft_revision', $revision)
            ->assertJsonPath('data.version', 1);
    }

    /** @test */
    public function a_stale_expected_revision_is_409_creates_no_version_and_leaves_the_draft_alone(): void
    {
        [$auth, $appId] = $this->newApp('ad01-pub-409');
        $reviewed = $this->save($auth['token'], $appId, 'ما راجعته');
        $current = $this->save($auth['token'], $appId, 'عدّله شخص آخر');

        $this->publish($auth['token'], $appId, ['expected_draft_revision' => $reviewed])
            ->assertStatus(409)
            ->assertJsonPath('reason', 'draft_changed_since_review')
            ->assertJsonPath('current_revision', $current)
            ->assertJsonPath('expected_revision', $reviewed)
            ->assertJsonStructure(['message', 'reason', 'current_revision', 'expected_revision']);

        $this->assertSame(0, BuilderPublishedExperienceVersion::withoutGlobalScopes()->where('builder_app_id', $appId)->count());
        $this->assertSame($current, (int) BuilderDraftExperience::withoutGlobalScopes()->where('builder_app_id', $appId)->value('revision'));
    }

    /** @test */
    public function an_expected_revision_ahead_of_the_server_is_also_409(): void
    {
        [$auth, $appId] = $this->newApp('ad01-pub-ahead');
        $this->save($auth['token'], $appId, 'س');

        $this->publish($auth['token'], $appId, ['expected_draft_revision' => 99])->assertStatus(409);
        $this->assertSame(0, BuilderPublishedExperienceVersion::withoutGlobalScopes()->where('builder_app_id', $appId)->count());
    }

    /** @test */
    public function publishing_without_expected_revision_still_works_and_records_the_source_revision(): void
    {
        [$auth, $appId] = $this->newApp('ad01-pub-compat');
        $revision = $this->save($auth['token'], $appId, 'قديم');

        $this->publish($auth['token'], $appId)->assertCreated()->assertJsonPath('data.source_draft_revision', $revision);
        $this->publish($auth['token'], $appId, ['expected_draft_revision' => null, 'note' => 'ملاحظة'])
            ->assertCreated()->assertJsonPath('data.version', 2);
    }

    /** @test */
    public function a_published_version_keeps_its_source_revision_after_the_draft_moves_on(): void
    {
        [$auth, $appId] = $this->newApp('ad01-pub-immutable');
        $revision = $this->save($auth['token'], $appId, 'الأولى');
        $this->publish($auth['token'], $appId, ['expected_draft_revision' => $revision])->assertCreated();
        $this->save($auth['token'], $appId, 'الثانية');

        $row = BuilderPublishedExperienceVersion::withoutGlobalScopes()->where('builder_app_id', $appId)->firstOrFail();
        $this->assertSame($revision, $row->source_draft_revision);
        $this->assertSame('الأولى', $row->schema['pages']['home']['children'][0]['props']['text']);
    }

    /**
     * @test
     *
     * @dataProvider invalidExpected
     */
    public function an_invalid_expected_revision_is_422_and_publishes_nothing(mixed $invalid): void
    {
        [$auth, $appId] = $this->newApp('ad01-pub-422-'.md5(json_encode($invalid)));

        $this->publish($auth['token'], $appId, ['expected_draft_revision' => $invalid])->assertStatus(422);
        $this->assertSame(0, BuilderPublishedExperienceVersion::withoutGlobalScopes()->where('builder_app_id', $appId)->count());
    }

    public static function invalidExpected(): array
    {
        return [[-1], ['abc'], [true], [1.5], [[1]]];
    }

    /** @test */
    public function another_tenant_gets_404_and_never_a_409_that_leaks_revisions(): void
    {
        [$authA, $appId] = $this->newApp('ad01-pub-iso-a');
        $authB = $this->registerTenant('ad01-pub-iso-b', 'owner@ad01-pub-iso-b.test');
        $this->save($authA['token'], $appId, 'خاص');

        $response = $this->publish($authB['token'], $appId, ['expected_draft_revision' => 0]);
        $response->assertStatus(404);
        $this->assertNull($response->json('current_revision'));
    }

    /** @test */
    public function a_role_without_publish_permission_is_forbidden_before_any_revision_check(): void
    {
        [$auth, $appId] = $this->newApp('ad01-pub-rbac');
        $token = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff@ad01-pub-rbac.test');

        $response = $this->publish($token, $appId, ['expected_draft_revision' => 123]);
        $response->assertForbidden();
        $this->assertNull($response->json('current_revision'));
    }
}
