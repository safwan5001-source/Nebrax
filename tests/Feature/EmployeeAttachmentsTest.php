<?php

namespace Tests\Feature;

use App\Models\Employee;
use App\Models\EmployeeAttachment;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * مسوّغات التعيين — مرفقات متعددة الملفات للموظف (هوية، شهادات، عقود
 * ممسوحة…)، بنمط مرفقات المصروفات القائم.
 * تشغيل: php artisan test --filter=EmployeeAttachmentsTest
 */
class EmployeeAttachmentsTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function makeEmployee(string $token, array $over = []): array
    {
        return $this->withToken($token)->postJson('/api/employees', array_merge([
            'name' => 'موظف', 'basic_salary' => 500000,
        ], $over))->assertCreated()['data'];
    }

    /** @test */
    public function multiple_files_can_be_uploaded_listed_and_downloaded(): void
    {
        Storage::fake('local');
        $auth = $this->registerTenant();
        $emp = $this->makeEmployee($auth['token']);

        $this->withToken($auth['token'])->getJson("/api/employees/{$emp['id']}/attachments")
            ->assertOk()->assertJsonCount(0, 'data');

        $res = $this->withToken($auth['token'])->postJson("/api/employees/{$emp['id']}/attachments", [
            'attachments' => [
                UploadedFile::fake()->create('national-id.pdf', 200, 'application/pdf'),
                UploadedFile::fake()->image('certificate.jpg'),
            ],
        ])->assertCreated();

        $res->assertJsonCount(2, 'data');
        $names = array_column($res['data'], 'original_name');
        $this->assertEqualsCanonicalizing(['national-id.pdf', 'certificate.jpg'], $names);

        $listed = $this->withToken($auth['token'])->getJson("/api/employees/{$emp['id']}/attachments")
            ->assertOk();
        $listed->assertJsonCount(2, 'data');

        $attachmentId = $listed['data'][0]['id'];
        $path = EmployeeAttachment::findOrFail($attachmentId)->path;
        Storage::disk('local')->assertExists($path);

        $this->withToken($auth['token'])
            ->get("/api/employees/{$emp['id']}/attachments/{$attachmentId}/download")
            ->assertOk();
    }

    /** @test */
    public function more_than_ten_files_or_a_disallowed_type_is_rejected(): void
    {
        Storage::fake('local');
        $auth = $this->registerTenant();
        $emp = $this->makeEmployee($auth['token']);

        $eleven = array_map(fn ($i) => UploadedFile::fake()->create("doc{$i}.pdf", 10, 'application/pdf'), range(1, 11));
        $this->withToken($auth['token'])->postJson("/api/employees/{$emp['id']}/attachments", [
            'attachments' => $eleven,
        ])->assertStatus(422);

        $this->withToken($auth['token'])->postJson("/api/employees/{$emp['id']}/attachments", [
            'attachments' => [UploadedFile::fake()->create('script.exe', 10, 'application/octet-stream')],
        ])->assertStatus(422);
    }

    /** @test */
    public function a_single_attachment_can_be_deleted_without_touching_the_rest(): void
    {
        Storage::fake('local');
        $auth = $this->registerTenant();
        $emp = $this->makeEmployee($auth['token']);

        $res = $this->withToken($auth['token'])->postJson("/api/employees/{$emp['id']}/attachments", [
            'attachments' => [
                UploadedFile::fake()->create('a.pdf', 10, 'application/pdf'),
                UploadedFile::fake()->create('b.pdf', 10, 'application/pdf'),
            ],
        ])->assertCreated();

        $toDelete = $res['data'][0]['id'];
        $keep = $res['data'][1]['id'];
        $deletedPath = EmployeeAttachment::findOrFail($toDelete)->path;

        $this->withToken($auth['token'])
            ->deleteJson("/api/employees/{$emp['id']}/attachments/{$toDelete}")->assertOk();

        Storage::disk('local')->assertMissing($deletedPath);
        $this->assertDatabaseHas('employee_attachments', ['id' => $keep]);
        $this->assertDatabaseMissing('employee_attachments', ['id' => $toDelete]);
    }

    /** @test */
    public function deleting_an_employee_removes_its_stored_attachments(): void
    {
        Storage::fake('local');
        $auth = $this->registerTenant();
        $emp = $this->makeEmployee($auth['token']);

        $res = $this->withToken($auth['token'])->postJson("/api/employees/{$emp['id']}/attachments", [
            'attachments' => [UploadedFile::fake()->create('a.pdf', 10, 'application/pdf')],
        ])->assertCreated();
        $path = EmployeeAttachment::findOrFail($res['data'][0]['id'])->path;

        $this->withToken($auth['token'])->deleteJson("/api/employees/{$emp['id']}")->assertOk();
        Storage::disk('local')->assertMissing($path);
    }

    /** @test */
    public function attachments_are_isolated_per_tenant(): void
    {
        Storage::fake('local');
        $a = $this->registerTenant('alpha', 'a@alpha.test');
        $b = $this->registerTenant('beta', 'b@beta.test');
        $empB = $this->makeEmployee($b['token']);

        $this->withToken($a['token'])->getJson("/api/employees/{$empB['id']}/attachments")->assertStatus(404);
        $this->withToken($a['token'])->postJson("/api/employees/{$empB['id']}/attachments", [
            'attachments' => [UploadedFile::fake()->create('a.pdf', 10, 'application/pdf')],
        ])->assertStatus(404);
    }
}
