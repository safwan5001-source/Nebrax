<?php

namespace Tests\Feature;

use App\Models\FuelNozzle;
use App\Models\FuelPump;
use App\Models\FuelShift;
use App\Models\FuelStationAuditEvent;
use App\Models\FuelTanker;
use App\Models\FuelTankerFill;
use App\Models\FuelTankerFillAttachment;
use App\Models\FuelTankerOwner;
use App\Services\FuelStationAuditTrail;
use App\Support\StationSessionBoundary;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use LogicException;
use RuntimeException;
use Tests\TestCase;

/**
 * TANKER-PR5 — مرفقات سندات تعبئة الصهاريج: الرفع (صورة/عدة صور/PDF)، فحص المحتوى الفعلي والأنواع والحجم والعدد، التخزين الخاص والتنزيل المصرَّح به، الإزالة والاستبدال
 * مع بقاء السجل التاريخي، سياسات المحطة (بعد الإغلاق/الإزالة/الإلزام)، الصلاحيات والعزل، idempotency بالمحتوى، فشل التخزين، وغياب أي أثر مالي أو مخزني أو على السند نفسه.
 */
class FuelTankerFillAttachmentTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use BuildsFuelStaffFixture;

    private const FILLS = '/api/fuel-stations/tanker-fills';
    private const ADD = ['fuel.tanker.fill.view', 'fuel.tanker.fill.attachment.add'];
    private const ALL = ['fuel.tanker.fill.view', 'fuel.tanker.fill.record', 'fuel.tanker.fill.void', 'fuel.tanker.fill.attachment.add', 'fuel.tanker.fill.attachment.remove'];

    private FuelNozzle $nozzle;
    private FuelPump $pump;
    private FuelTankerOwner $owner;
    private FuelShift $shift;
    private int $seq = 0;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        config(['fuel_stations.tanker_management_enabled' => true, 'fuel_stations.tanker_fills_enabled' => true]);
        $this->buildFixture();
        app(TenantContext::class)->set($this->tenantId);
        $this->pump = FuelPump::create(['branch_id' => $this->fx['branchA']->id, 'fuel_station_id' => $this->fx['s1']->id, 'pump_number' => '02', 'name' => 'مضخة 2']);
        $this->nozzle = FuelNozzle::create([
            'branch_id' => $this->fx['branchA']->id, 'fuel_station_id' => $this->fx['s1']->id, 'fuel_pump_id' => $this->pump->id, 'fuel_tank_id' => $this->fx['t1']->id,
            'fuel_product_id' => $this->fx['fuel']->id, 'nozzle_number' => '1',
        ]);
        $this->owner = FuelTankerOwner::create(['name' => 'عسكر', 'code' => 'ASK', 'status' => 'active']);
        FuelTanker::create(['fuel_tanker_owner_id' => $this->owner->id, 'plate_number' => 'أ ب ج 1234', 'plate_key' => 'ABJ1234', 'capacity_milliliters' => 5_000_000, 'status' => 'active']);
        $this->shift = FuelShift::create([
            'branch_id' => $this->fx['branchA']->id, 'fuel_station_id' => $this->fx['s1']->id, 'number' => 'FSH-T5-1', 'status' => FuelShift::STATUS_OPEN,
            'opening_float_minor' => 0, 'idempotency_key' => 'shift-t5-1', 'opened_by' => $this->makeUser('seller-t5', 'role-seller-t5', ['fuel_stations.view'])['user']->id, 'opened_at' => now(),
        ]);
    }

    // ───────────────────────── أدوات ─────────────────────────

    /** @param list<string> $permissions @return array{user: \App\Models\User, token: string} */
    private function staff(array $permissions = self::ALL, ?array $stations = null): array
    {
        $n = ++$this->seq;

        return $this->makeUser("t5staff{$n}", "role-t5-{$n}", array_merge(['fuel_stations.view'], $permissions), $stations);
    }

    private function fill(string $voucher = '4052'): FuelTankerFill
    {
        $response = $this->withToken($this->fx['owner'])->postJson(self::FILLS, [
            'fuel_station_id' => $this->fx['s1']->id, 'fuel_nozzle_id' => $this->nozzle->id, 'fuel_tanker_owner_id' => $this->owner->id,
            'voucher_number' => $voucher, 'quantity_liters' => '2000', 'idempotency_key' => 'fill-t5-' . (++$this->seq),
        ])->assertCreated();

        return FuelTankerFill::query()->findOrFail($response->json('data.id'));
    }

    private function url(FuelTankerFill $fill, string $suffix = ''): string
    {
        return self::FILLS . "/{$fill->id}/attachments" . $suffix;
    }

    private function image(string $name = 'voucher.jpg', int $w = 640, int $h = 480): UploadedFile
    {
        return UploadedFile::fake()->image($name, $w, $h);
    }

    private function pdf(string $name = 'voucher.pdf', int $kb = 4): UploadedFile
    {
        return UploadedFile::fake()->createWithContent($name, "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 10 10]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n" . str_repeat('x', $kb * 1024));
    }

    /** @param list<UploadedFile> $files */
    private function upload(string $token, FuelTankerFill $fill, array $files): \Illuminate\Testing\TestResponse
    {
        return $this->withToken($token)->post($this->url($fill), ['attachments' => $files], ['Accept' => 'application/json']);
    }

    private function setPolicy(array $values): void
    {
        $this->withToken($this->fx['owner'])->putJson('/api/fuel-stations/settings', $values + ['reason' => 'اختبار PR-5'])->assertOk();
    }

    private function closeShift(): void
    {
        $this->shift->forceFill(['status' => FuelShift::STATUS_CLOSED, 'closed_at' => now()])->save();
    }

    /** @return array<string,int> */
    private function sideEffects(): array
    {
        $counts = [];
        foreach (['stock_movements', 'journal_entries', 'journal_lines', 'invoices', 'payments', 'fuel_sales', 'fuel_operational_ledgers', 'fuel_shifts', 'fuel_tanker_fills'] as $table) {
            $counts[$table] = (int) DB::table($table)->count();
        }

        return $counts;
    }

    // ───────────────────────── الرفع والعرض ─────────────────────────

    /** @test */
    public function a_single_image_is_stored_privately_with_full_metadata_and_linked_to_the_ftf_and_paper_voucher(): void
    {
        $fill = $this->fill('04052');
        $staff = $this->staff();
        $before = $this->sideEffects();
        $fillBefore = $fill->fresh()->getAttributes();

        $response = $this->upload($staff['token'], $fill, [$this->image('صورة السند.jpg')])->assertCreated();
        $row = $response->json('data.0');

        $this->assertSame($fill->number, $row['fill_number'], 'مربوط بالسند الإلكتروني FTF');
        $this->assertSame('04052', $row['voucher_number'], 'ومعه رقم السند الورقي حرفياً');
        $this->assertSame('صورة السند.jpg', $row['original_name']);
        $this->assertSame('image/jpeg', $row['mime_type']);
        $this->assertSame('image', $row['kind']);
        $this->assertGreaterThan(0, $row['size']);
        $this->assertSame('active', $row['status']);
        $this->assertSame($staff['user']->id, $row['uploaded_by']);
        $this->assertNotNull($row['uploaded_at']);
        foreach (['disk', 'path', 'sha256', 'tenant_id'] as $hidden) {
            $this->assertArrayNotHasKey($hidden, $row, "{$hidden} لا يُكشف");
        }

        $stored = FuelTankerFillAttachment::query()->findOrFail($row['id']);
        Storage::disk('local')->assertExists($stored->path);
        $this->assertSame('local', $stored->disk);
        $this->assertSame($fill->branch_id, $stored->branch_id);
        $this->assertSame($this->tenantId, $stored->tenant_id);

        // السند نفسه والبيانات المالية/المخزنية لم تتأثر.
        $this->assertSame($fillBefore, $fill->fresh()->getAttributes());
        $this->assertSame('pending_integration', $fill->fresh()->inventory_status);
        $this->assertSame($before, $this->sideEffects());
        $this->assertSame(1, $this->withToken($staff['token'])->getJson(self::FILLS . "/{$fill->id}")->assertOk()->json('data.attachments_count'));
    }

    /** @test */
    public function several_images_and_a_pdf_can_be_attached_to_one_voucher_and_listed_with_policy_state(): void
    {
        $fill = $this->fill();
        $staff = $this->staff();

        $this->upload($staff['token'], $fill, [$this->image('a.jpg', 300, 200), $this->image('b.png', 310, 210), $this->pdf()])->assertCreated()->assertJsonPath('meta.created', 3);
        $list = $this->withToken($staff['token'])->getJson($this->url($fill))->assertOk();

        $this->assertCount(3, $list->json('data'));
        // الترتيب داخل الثانية الواحدة غير مضمون (وقت الرفع بدقة ثانية)؛ المحتوى هو المعتمد.
        $this->assertEqualsCanonicalizing(['image/jpeg', 'image/png', 'application/pdf'], array_column($list->json('data'), 'mime_type'));
        $this->assertEqualsCanonicalizing(['image', 'image', 'pdf'], array_column($list->json('data'), 'kind'));
        $this->assertSame(3, $list->json('meta.active_count'));
        $this->assertSame('present', $list->json('meta.status'));
        $this->assertSame(10, $list->json('meta.policy.max_count'));
        $this->assertSame(10 * 1024 * 1024, $list->json('meta.policy.max_bytes'));
        $this->assertSame(['image/jpeg', 'image/png', 'application/pdf'], $list->json('meta.policy.mime_types'));
        $this->assertFalse($list->json('meta.policy.required'));

        $index = $this->withToken($staff['token'])->getJson(self::FILLS)->assertOk()->json('data');
        $this->assertSame(3, $index[0]['attachments_count']);
        $this->assertSame([], $this->withToken($staff['token'])->getJson($this->url($this->fill('9')))->assertOk()->json('data'));
    }

    /** @test */
    public function re_sending_the_same_content_never_creates_a_second_attachment(): void
    {
        $fill = $this->fill();
        $staff = $this->staff();
        $content = $this->image('same.jpg', 500, 400);

        $first = $this->upload($staff['token'], $fill, [$content])->assertCreated();
        // إعادة الطلب (بعد انقطاع الرد) بالملف نفسه ولو باسم مختلف ⇒ الصف نفسه بلا كتابة جديدة.
        $copy = UploadedFile::fake()->createWithContent('renamed.jpg', file_get_contents($content->getRealPath()));
        $again = $this->upload($staff['token'], $fill, [$copy])->assertOk();

        $this->assertTrue($again->json('meta.replayed'));
        $this->assertSame($first->json('data.0.id'), $again->json('data.0.id'));
        $this->assertSame(1, FuelTankerFillAttachment::query()->count());
        $this->assertCount(1, Storage::disk('local')->allFiles());

        // ملفان بالمحتوى نفسه داخل الطلب الواحد يُدمجان.
        $twin = $this->image('twin.jpg', 411, 311);
        $twinCopy = UploadedFile::fake()->createWithContent('twin2.jpg', file_get_contents($twin->getRealPath()));
        $this->upload($staff['token'], $fill, [$twin, $twinCopy])->assertCreated()->assertJsonCount(1, 'data');
        $this->assertSame(2, FuelTankerFillAttachment::query()->count());
    }

    // ───────────────────────── الأنواع والحجم والعدد ─────────────────────────

    /** @test */
    public function the_real_file_content_decides_not_the_extension_and_executables_are_rejected(): void
    {
        $fill = $this->fill();
        $staff = $this->staff();

        $script = UploadedFile::fake()->createWithContent('malware.jpg', "<?php system(\$_GET['c']); ?>");
        $this->upload($staff['token'], $fill, [$script])->assertStatus(422)->assertJsonPath('reason', 'attachment_invalid');

        $elf = UploadedFile::fake()->createWithContent('tool.pdf', "\x7FELF\x02\x01\x01" . str_repeat("\0", 64));
        $this->upload($staff['token'], $fill, [$elf])->assertStatus(422)->assertJsonPath('reason', 'attachment_invalid');

        $html = UploadedFile::fake()->createWithContent('page.png', '<html><script>alert(1)</script></html>');
        $this->upload($staff['token'], $fill, [$html])->assertStatus(422);

        // صورة حقيقية بامتداد غير مطابق لمحتواها.
        $png = $this->image('real.png');
        $liar = UploadedFile::fake()->createWithContent('liar.jpg', file_get_contents($png->getRealPath()));
        $this->upload($staff['token'], $fill, [$liar])->assertStatus(422)->assertJsonPath('reason', 'attachment_invalid');

        // GIF صورة حقيقية لكنها خارج السقف الصلب.
        $this->upload($staff['token'], $fill, [UploadedFile::fake()->image('a.gif', 20, 20)])->assertStatus(422);

        $this->assertSame(0, FuelTankerFillAttachment::query()->count());
        $this->assertSame([], Storage::disk('local')->allFiles());
    }

    /** @test */
    public function webp_stays_outside_the_hard_ceiling_even_though_the_inspector_understands_it(): void
    {
        if (! function_exists('imagewebp')) {
            $this->markTestSkipped('GD بلا WebP.');
        }
        $fill = $this->fill();
        $path = tempnam(sys_get_temp_dir(), 'webp');
        $image = imagecreatetruecolor(40, 40);
        imagewebp($image, $path);
        $webp = new UploadedFile($path, 'photo.webp', 'image/webp', null, true);

        $this->upload($this->staff()['token'], $fill, [$webp])->assertStatus(422)->assertJsonPath('reason', 'attachment_type_not_allowed');
        $this->assertSame(0, FuelTankerFillAttachment::query()->count());
    }

    /** @test */
    public function the_station_policy_narrows_types_size_and_count_but_never_widens_the_hard_ceiling(): void
    {
        $fill = $this->fill();
        $staff = $this->staff();

        $this->setPolicy(['tanker_fill_attachment_types' => 'images_only']);
        $this->upload($staff['token'], $fill, [$this->pdf()])->assertStatus(422)->assertJsonPath('reason', 'attachment_type_not_allowed');
        $this->upload($staff['token'], $fill, [$this->image('ok.jpg')])->assertCreated();

        $this->setPolicy(['tanker_fill_attachment_types' => 'images_and_pdf', 'tanker_fill_attachment_max_size_mb' => 1]);
        $this->upload($staff['token'], $fill, [$this->pdf('big.pdf', 1200)])->assertStatus(422)->assertJsonPath('reason', 'attachment_too_large')->assertJsonPath('details.max_bytes', 1024 * 1024);
        $this->upload($staff['token'], $fill, [$this->pdf('small.pdf', 100)])->assertCreated();

        $this->setPolicy(['tanker_fill_attachment_max_count' => 3]);
        $this->upload($staff['token'], $fill, [$this->image('c.jpg', 211, 111)])->assertCreated();
        $this->upload($staff['token'], $fill, [$this->image('d.jpg', 212, 112)])->assertStatus(422)->assertJsonPath('reason', 'attachment_limit_reached')->assertJsonPath('details.max_count', 3);
        $this->assertSame(3, FuelTankerFillAttachment::query()->where('status', 'active')->count());

        // السقف الصلب: لا يُقبل ضبط يتجاوز 10 م.ب أو 20 مرفقاً، ولا نوع خارج القائمة.
        $this->withToken($this->fx['owner'])->putJson('/api/fuel-stations/settings', ['tanker_fill_attachment_max_size_mb' => 11, 'reason' => 'x'])->assertStatus(422);
        $this->withToken($this->fx['owner'])->putJson('/api/fuel-stations/settings', ['tanker_fill_attachment_max_count' => 21, 'reason' => 'x'])->assertStatus(422);
        $this->withToken($this->fx['owner'])->putJson('/api/fuel-stations/settings', ['tanker_fill_attachment_types' => 'everything', 'reason' => 'x'])->assertStatus(422);
        $this->withToken($this->fx['owner'])->putJson('/api/fuel-stations/settings', ['tanker_voucher_attachment_required' => true, 'reason' => 'x'])->assertStatus(422);
        $this->withToken($this->fx['owner'])->putJson('/api/fuel-stations/settings', ['tanker_voucher_attachment_required' => 'sometimes', 'reason' => 'x'])->assertStatus(422);
        // حد الطلب الواحد 5 ملفات.
        $this->upload($staff['token'], $this->fill('77'), array_map(fn ($i) => $this->image("m{$i}.jpg", 100 + $i, 100), range(1, 6)))->assertStatus(422);
    }

    /** @test */
    public function the_count_limit_counts_only_active_attachments_and_removal_frees_a_slot(): void
    {
        $fill = $this->fill();
        $staff = $this->staff();
        $this->setPolicy(['tanker_fill_attachment_max_count' => 1]);

        $first = $this->upload($staff['token'], $fill, [$this->image('one.jpg', 301, 201)])->assertCreated()->json('data.0.id');
        $this->upload($staff['token'], $fill, [$this->image('two.jpg', 302, 202)])->assertStatus(422)->assertJsonPath('reason', 'attachment_limit_reached');

        $this->withToken($staff['token'])->deleteJson($this->url($fill, "/{$first}"), ['reason' => 'صورة غير واضحة'])->assertOk();
        $this->upload($staff['token'], $fill, [$this->image('two.jpg', 302, 202)])->assertCreated();
    }

    // ───────────────────────── الصلاحيات والعزل والبوابات ─────────────────────────

    /** @test */
    public function each_action_needs_its_own_permission(): void
    {
        $fill = $this->fill();
        $viewer = $this->staff(['fuel.tanker.fill.view']);
        $adder = $this->staff(self::ADD);
        $remover = $this->staff(['fuel.tanker.fill.view', 'fuel.tanker.fill.attachment.remove']);
        $recorderOnly = $this->staff(['fuel.tanker.fill.view', 'fuel.tanker.fill.record', 'fuel.tanker.fill.void']);
        $nothing = $this->staff([]);

        $this->upload($viewer['token'], $fill, [$this->image()])->assertForbidden();
        $this->upload($recorderOnly['token'], $fill, [$this->image()])->assertForbidden('تسجيل التعبئة وحده لا يكفي لإرفاق صورة');
        $this->upload($nothing['token'], $fill, [$this->image()])->assertForbidden();
        $id = $this->upload($adder['token'], $fill, [$this->image('a.jpg')])->assertCreated()->json('data.0.id');

        $this->withToken($nothing['token'])->getJson($this->url($fill))->assertForbidden();
        $this->withToken($viewer['token'])->getJson($this->url($fill))->assertOk();
        $this->withToken($viewer['token'])->get($this->url($fill, "/{$id}/download"))->assertOk();
        $this->withToken($nothing['token'])->get($this->url($fill, "/{$id}/download"))->assertForbidden();

        $this->withToken($viewer['token'])->deleteJson($this->url($fill, "/{$id}"), ['reason' => 'اختبار'])->assertForbidden();
        $this->withToken($adder['token'])->deleteJson($this->url($fill, "/{$id}"), ['reason' => 'اختبار'])->assertForbidden();
        $this->withToken($adder['token'])->post($this->url($fill, "/{$id}/replace"), ['attachment' => $this->image('n.jpg', 333, 222)], ['Accept' => 'application/json'])->assertForbidden();
        // الاستبدال إزالة + إضافة: صلاحية الإزالة وحدها لا تكفي.
        $this->withToken($remover['token'])->post($this->url($fill, "/{$id}/replace"), ['attachment' => $this->image('n.jpg', 333, 222)], ['Accept' => 'application/json'])->assertForbidden();
        $this->assertSame('active', FuelTankerFillAttachment::query()->findOrFail($id)->status);

        $this->withToken($remover['token'])->deleteJson($this->url($fill, "/{$id}"), ['reason' => 'صورة خاطئة'])->assertOk();
    }

    /** @test */
    public function the_new_permissions_are_owner_admin_only_by_default_and_a_pin_session_cannot_reach_the_endpoints(): void
    {
        $matrix = (new \ReflectionClass(\App\Support\Rbac::class))->getConstant('MATRIX');
        foreach (['fuel.tanker.fill.attachment.add', 'fuel.tanker.fill.attachment.remove'] as $permission) {
            $this->assertContains($permission, \App\Support\Rbac::PERMISSIONS);
            foreach ($matrix as $role => $permissions) {
                $this->assertNotContains($permission, $permissions, "{$role} لا يملك {$permission} ضمنياً");
            }
            foreach (\App\Support\FuelStaffTemplates::all() as $template => $definition) {
                $this->assertNotContains($permission, $definition['permissions'], "قالب {$template} لا يمنحها قبل تكامل تطبيق المحطة (PR-7)");
            }
        }

        $fill = $this->fill();
        $staff = $this->staff();
        $id = $this->upload($staff['token'], $fill, [$this->image()])->assertCreated()->json('data.0.id');
        $session = $staff['user']->createToken(StationSessionBoundary::TOKEN_NAME, [StationSessionBoundary::ABILITY])->plainTextToken;

        $this->withToken($session)->getJson($this->url($fill))->assertForbidden();
        $this->withToken($session)->get($this->url($fill, "/{$id}/download"))->assertForbidden();
        $this->withToken($session)->post($this->url($fill), ['attachments' => [$this->image('p.jpg', 120, 90)]], ['Accept' => 'application/json'])->assertForbidden();
        $this->withToken($session)->deleteJson($this->url($fill, "/{$id}"), ['reason' => 'اختبار'])->assertForbidden();
        $this->assertSame(1, FuelTankerFillAttachment::query()->count());
    }

    /** @test */
    public function both_deployment_gates_close_every_attachment_route_with_a_uniform_404(): void
    {
        $fill = $this->fill();
        $staff = $this->staff();
        $id = $this->upload($staff['token'], $fill, [$this->image()])->assertCreated()->json('data.0.id');

        foreach ([['fuel_stations.tanker_fills_enabled' => false], ['fuel_stations.tanker_management_enabled' => false]] as $closed) {
            config($closed);
            $this->withToken($staff['token'])->getJson($this->url($fill))->assertNotFound();
            $this->withToken($staff['token'])->get($this->url($fill, "/{$id}/download"))->assertNotFound();
            $this->upload($staff['token'], $fill, [$this->image('g.jpg', 140, 90)])->assertNotFound();
            $this->withToken($staff['token'])->deleteJson($this->url($fill, "/{$id}"), ['reason' => 'اختبار'])->assertNotFound();
            $this->withToken($this->fx['owner'])->getJson($this->url($fill))->assertNotFound();
            config(['fuel_stations.tanker_fills_enabled' => true, 'fuel_stations.tanker_management_enabled' => true]);
        }
        $this->assertSame(1, FuelTankerFillAttachment::query()->count());
    }

    /** @test */
    public function station_scope_and_tenant_isolation_hide_attachments_even_with_a_valid_id(): void
    {
        $fill = $this->fill();
        $staff = $this->staff();
        $id = $this->upload($staff['token'], $fill, [$this->image()])->assertCreated()->json('data.0.id');

        // مستخدم محطة أخرى: 404 موحَّد على كل العمليات.
        $restricted = $this->staff(self::ALL, [$this->fx['s2']->id]);
        $this->withToken($restricted['token'])->getJson($this->url($fill))->assertNotFound();
        $this->withToken($restricted['token'])->get($this->url($fill, "/{$id}/download"))->assertNotFound();
        $this->upload($restricted['token'], $fill, [$this->image('r.jpg', 150, 100)])->assertNotFound();
        $this->withToken($restricted['token'])->deleteJson($this->url($fill, "/{$id}"), ['reason' => 'اختبار'])->assertNotFound();

        // معرّف مرفق صحيح مع سند آخر ⇒ 404 (لا ربط عبر السندات).
        $other = $this->fill('OTHER-1');
        $this->withToken($staff['token'])->get($this->url($other, "/{$id}/download"))->assertNotFound();
        $this->withToken($staff['token'])->deleteJson($this->url($other, "/{$id}"), ['reason' => 'اختبار'])->assertNotFound();

        // مؤسسة أخرى: لا يرى ولا ينزّل بمعرّف صحيح.
        $tenant = $this->registerTenant('fuel-t5-other', 'owner@fuel-t5-other.test', autoEnableApplications: true);
        app(TenantContext::class)->set($tenant['tenant_id']);
        app(\App\Services\EntitlementGrantService::class)->grant(
            \App\Models\Tenant::findOrFail($tenant['tenant_id']), 'fuel_stations.core', \App\Support\EntitlementAccessMode::FULL, \App\Support\EntitlementSourceType::MANUAL,
            \Carbon\CarbonImmutable::now('UTC'), grantReasonCode: 'test_fuel_t5_other', reason: 'اختبار عزل PR-5.',
        );
        $this->withToken($tenant['token'])->getJson($this->url($fill))->assertNotFound();
        $this->withToken($tenant['token'])->get($this->url($fill, "/{$id}/download"))->assertNotFound();
        $this->withToken($tenant['token'])->deleteJson($this->url($fill, "/{$id}"), ['reason' => 'اختبار'])->assertNotFound();
        $this->assertSame('active', DB::table('fuel_tanker_fill_attachments')->where('id', $id)->value('status'));
    }

    // ───────────────────────── التخزين الخاص والتنزيل ─────────────────────────

    /** @test */
    public function download_streams_the_exact_bytes_privately_with_a_name_that_carries_the_ftf_and_voucher(): void
    {
        $fill = $this->fill('04052');
        $staff = $this->staff();
        $image = $this->image('أصل السند.jpg', 321, 123);
        $bytes = file_get_contents($image->getRealPath());
        $id = $this->upload($staff['token'], $fill, [$image])->assertCreated()->json('data.0.id');

        $response = $this->withToken($staff['token'])->get($this->url($fill, "/{$id}/download"))->assertOk();
        $this->assertSame($bytes, $response->streamedContent());
        $this->assertSame('image/jpeg', $response->headers->get('Content-Type'));
        $this->assertSame('nosniff', $response->headers->get('X-Content-Type-Options'));
        $this->assertStringContainsString('no-store', (string) $response->headers->get('Cache-Control'));
        $this->assertStringContainsString('private', (string) $response->headers->get('Cache-Control'));
        $this->assertNull($response->headers->get('Location'), 'لا تحويل إلى رابط تخزين عام ولا presigned');
        $disposition = rawurldecode((string) $response->headers->get('Content-Disposition'));
        $this->assertStringContainsString($fill->number, $disposition);
        $this->assertStringContainsString('04052', $disposition);

        // لا مصادقة ⇒ لا ملف.
        $this->flushHeaders();
        $this->get($this->url($fill, "/{$id}/download"), ['Accept' => 'application/json'])->assertUnauthorized();
        // التخزين خاص: القرص المحلي غير العام ولا رابط عام للملف.
        $this->assertNotContains('public', [FuelTankerFillAttachment::query()->findOrFail($id)->disk]);
    }

    /** @test */
    public function a_file_missing_from_storage_returns_404_not_a_server_error(): void
    {
        $fill = $this->fill();
        $staff = $this->staff();
        $id = $this->upload($staff['token'], $fill, [$this->image()])->assertCreated()->json('data.0.id');
        Storage::disk('local')->delete(FuelTankerFillAttachment::query()->findOrFail($id)->path);

        $this->withToken($staff['token'])->get($this->url($fill, "/{$id}/download"))->assertNotFound();
    }

    // ───────────────────────── الإزالة والاستبدال والسجل التاريخي ─────────────────────────

    /** @test */
    public function removal_keeps_the_row_and_the_file_records_who_when_and_why_and_never_touches_the_fill(): void
    {
        $fill = $this->fill();
        $staff = $this->staff();
        $id = $this->upload($staff['token'], $fill, [$this->image()])->assertCreated()->json('data.0.id');
        $path = FuelTankerFillAttachment::query()->findOrFail($id)->path;
        $before = $this->sideEffects();

        $this->withToken($staff['token'])->deleteJson($this->url($fill, "/{$id}"), [])->assertStatus(422);
        $this->withToken($staff['token'])->deleteJson($this->url($fill, "/{$id}"), ['reason' => 'ab'])->assertStatus(422);
        $this->withToken($staff['token'])->deleteJson($this->url($fill, "/{$id}"), ['reason' => 'صورة غير واضحة', 'extra' => 1])->assertStatus(422);

        $removed = $this->withToken($staff['token'])->deleteJson($this->url($fill, "/{$id}"), ['reason' => 'صورة غير واضحة'])->assertOk();
        $this->assertSame('removed', $removed->json('data.status'));
        $this->assertSame($staff['user']->id, $removed->json('data.removed_by'));
        $this->assertSame('صورة غير واضحة', $removed->json('data.removal_reason'));
        $this->assertNotNull($removed->json('data.removed_at'));

        // الصف والملف باقيان، والسند وحالته وعدّه كما هي.
        $row = FuelTankerFillAttachment::query()->findOrFail($id);
        $this->assertSame('removed', $row->status);
        Storage::disk('local')->assertExists($path);
        $this->assertSame($before, $this->sideEffects());
        $this->assertSame('recorded', $fill->fresh()->status);
        $this->assertSame(0, $this->withToken($staff['token'])->getJson(self::FILLS . "/{$fill->id}")->json('data.attachments_count'));

        // مدقَّق بالفاعل والسبب.
        $event = FuelStationAuditEvent::query()->where('action', 'tanker_fill.attachment_removed')->sole();
        $this->assertSame($staff['user']->id, $event->actor_id);
        $this->assertSame('صورة غير واضحة', $event->reason);
        $this->assertSame($fill->id, $event->subject_id);
        $this->assertSame($id, $event->after['attachment_id']);
        $this->assertArrayNotHasKey('path', $event->after['attachment']);

        // idempotent: الإزالة المتكررة تعيد المُزال بلا حدث ثانٍ ولا تغيير للسبب.
        $again = $this->withToken($staff['token'])->deleteJson($this->url($fill, "/{$id}"), ['reason' => 'سبب آخر'])->assertOk();
        $this->assertTrue($again->json('meta.replayed'));
        $this->assertSame('صورة غير واضحة', $again->json('data.removal_reason'));
        $this->assertSame(1, FuelStationAuditEvent::query()->where('action', 'tanker_fill.attachment_removed')->count());
    }

    /** @test */
    public function removed_attachments_leave_the_active_list_and_stay_visible_as_history_only_to_those_who_can_remove(): void
    {
        $fill = $this->fill();
        $remover = $this->staff();
        $viewer = $this->staff(['fuel.tanker.fill.view']);
        $kept = $this->upload($remover['token'], $fill, [$this->image('keep.jpg', 201, 101)])->assertCreated()->json('data.0.id');
        $gone = $this->upload($remover['token'], $fill, [$this->image('gone.jpg', 202, 102)])->assertCreated()->json('data.0.id');
        $this->withToken($remover['token'])->deleteJson($this->url($fill, "/{$gone}"), ['reason' => 'مكرر'])->assertOk();

        $this->assertSame([$kept], array_column($this->withToken($viewer['token'])->getJson($this->url($fill))->json('data'), 'id'));
        $this->assertSame([$kept], array_column($this->withToken($viewer['token'])->getJson($this->url($fill) . '?history=1')->json('data'), 'id'), 'العارض لا يرى التاريخ');
        $history = $this->withToken($remover['token'])->getJson($this->url($fill) . '?history=1')->assertOk()->json('data');
        $this->assertEqualsCanonicalizing([$kept, $gone], array_column($history, 'id'));

        // الملف التاريخي لا ينزّله إلا من يملك صلاحية الإزالة.
        $this->withToken($viewer['token'])->get($this->url($fill, "/{$gone}/download"))->assertNotFound();
        $this->withToken($remover['token'])->get($this->url($fill, "/{$gone}/download"))->assertOk();
    }

    /** @test */
    public function the_same_content_can_be_attached_again_after_it_was_removed(): void
    {
        $fill = $this->fill();
        $staff = $this->staff();
        $image = $this->image('again.jpg', 260, 160);
        $first = $this->upload($staff['token'], $fill, [$image])->assertCreated()->json('data.0.id');
        $this->withToken($staff['token'])->deleteJson($this->url($fill, "/{$first}"), ['reason' => 'خطأ في الرفع'])->assertOk();

        $copy = UploadedFile::fake()->createWithContent('again.jpg', file_get_contents($image->getRealPath()));
        $second = $this->upload($staff['token'], $fill, [$copy])->assertCreated()->json('data.0.id');
        $this->assertNotSame($first, $second);
        $this->assertSame(2, FuelTankerFillAttachment::query()->count());
        $this->assertSame(1, FuelTankerFillAttachment::query()->where('status', 'active')->count());
    }

    /** @test */
    public function replacing_creates_a_new_active_attachment_and_keeps_the_old_one_as_history(): void
    {
        $fill = $this->fill();
        $staff = $this->staff();
        $old = $this->upload($staff['token'], $fill, [$this->image('old.jpg', 400, 300)])->assertCreated()->json('data.0.id');
        $oldPath = FuelTankerFillAttachment::query()->findOrFail($old)->path;

        $new = UploadedFile::fake()->image('new.jpg', 410, 310);
        $response = $this->withToken($staff['token'])->post($this->url($fill, "/{$old}/replace"), ['attachment' => $new], ['Accept' => 'application/json'])->assertCreated();
        $newId = $response->json('data.id');

        $this->assertSame($old, $response->json('data.replaces_attachment_id'));
        $this->assertSame('active', $response->json('data.status'));
        $oldRow = FuelTankerFillAttachment::query()->findOrFail($old);
        $this->assertSame('replaced', $oldRow->status);
        $this->assertSame($newId, $oldRow->replaced_by_attachment_id);
        $this->assertSame($staff['user']->id, $oldRow->removed_by);
        Storage::disk('local')->assertExists($oldPath);
        Storage::disk('local')->assertExists(FuelTankerFillAttachment::query()->findOrFail($newId)->path);
        $this->assertSame(1, FuelTankerFillAttachment::query()->where('status', 'active')->count());

        $event = FuelStationAuditEvent::query()->where('action', 'tanker_fill.attachment_replaced')->sole();
        $this->assertSame($old, $event->after['attachment_id']);
        $this->assertSame($newId, $event->after['replaced_by_attachment_id']);

        // إعادة الطلب نفسه بعد انقطاع الرد ⇒ الجديد نفسه بلا نسخة ثالثة.
        $retry = UploadedFile::fake()->createWithContent('new.jpg', file_get_contents($new->getRealPath()));
        $again = $this->withToken($staff['token'])->post($this->url($fill, "/{$old}/replace"), ['attachment' => $retry], ['Accept' => 'application/json'])->assertOk();
        $this->assertTrue($again->json('meta.replayed'));
        $this->assertSame($newId, $again->json('data.id'));
        $this->assertSame(2, FuelTankerFillAttachment::query()->count());

        // ملف مختلف على مرفق مُستبدَل أو مُزال ⇒ 409؛ والمحتوى نفسه أو المكرر مرفوض.
        $this->withToken($staff['token'])->post($this->url($fill, "/{$old}/replace"), ['attachment' => $this->image('x.jpg', 450, 350)], ['Accept' => 'application/json'])->assertStatus(409)->assertJsonPath('reason', 'attachment_not_active');
        $same = UploadedFile::fake()->createWithContent('same.jpg', file_get_contents($new->getRealPath()));
        $this->withToken($staff['token'])->post($this->url($fill, "/{$newId}/replace"), ['attachment' => $same], ['Accept' => 'application/json'])->assertStatus(422)->assertJsonPath('reason', 'attachment_same_content');
        $other = $this->upload($staff['token'], $fill, [$this->image('o.jpg', 500, 400)])->assertCreated()->json('data.0.id');
        $dup = UploadedFile::fake()->createWithContent('dup.jpg', file_get_contents($new->getRealPath()));
        $this->withToken($staff['token'])->post($this->url($fill, "/{$other}/replace"), ['attachment' => $dup], ['Accept' => 'application/json'])->assertStatus(409)->assertJsonPath('reason', 'attachment_duplicate');
    }

    // ───────────────────────── السياسات ─────────────────────────

    /** @test */
    public function adding_after_the_shift_closed_follows_the_station_policy_and_a_replay_is_always_answered(): void
    {
        $fill = $this->fill();
        $staff = $this->staff();
        $image = $this->image('before.jpg', 280, 180);
        $this->upload($staff['token'], $fill, [$image])->assertCreated();
        $this->closeShift();

        // الافتراضي: تُضاف بعد الإغلاق (دليل فقط).
        $this->upload($staff['token'], $fill, [$this->image('after.jpg', 281, 181)])->assertCreated();

        $this->setPolicy(['tanker_fill_attachment_after_close' => 'deny']);
        $state = $this->withToken($staff['token'])->getJson($this->url($fill))->json('meta');
        $this->assertFalse($state['can_add']);
        $this->assertSame('shift_closed', $state['add_blocked_reason']);
        $this->upload($staff['token'], $fill, [$this->image('late.jpg', 282, 182)])->assertStatus(422)->assertJsonPath('reason', 'attachment_add_blocked')->assertJsonPath('details.blocked_reason', 'shift_closed');
        // إعادة طلب أُنجز قبل الإغلاق تُجاب ولا تُحجب.
        $copy = UploadedFile::fake()->createWithContent('before.jpg', file_get_contents($image->getRealPath()));
        $this->upload($staff['token'], $fill, [$copy])->assertOk()->assertJsonPath('meta.replayed', true);
        $this->assertSame(2, FuelTankerFillAttachment::query()->count());
    }

    /** @test */
    public function removal_and_replacement_follow_the_removal_policy(): void
    {
        $fill = $this->fill();
        $staff = $this->staff();
        $a = $this->upload($staff['token'], $fill, [$this->image('a.jpg', 250, 150)])->assertCreated()->json('data.0.id');
        $b = $this->upload($staff['token'], $fill, [$this->image('b.jpg', 251, 151)])->assertCreated()->json('data.0.id');
        $replace = fn (string $id, int $w) => $this->withToken($staff['token'])->post($this->url($fill, "/{$id}/replace"), ['attachment' => $this->image('r.jpg', $w, 140)], ['Accept' => 'application/json']);
        $remove = fn (string $id) => $this->withToken($staff['token'])->deleteJson($this->url($fill, "/{$id}"), ['reason' => 'اختبار السياسة']);

        // الافتراضي open_shift_only: بعد الإغلاق لا إزالة ولا استبدال.
        $this->closeShift();
        $state = $this->withToken($staff['token'])->getJson($this->url($fill))->json('meta');
        $this->assertFalse($state['can_remove']);
        $this->assertSame('shift_closed', $state['remove_blocked_reason']);
        $remove($a)->assertStatus(422)->assertJsonPath('reason', 'attachment_removal_blocked')->assertJsonPath('details.blocked_reason', 'shift_closed');
        $replace($a, 260)->assertStatus(422)->assertJsonPath('reason', 'attachment_removal_blocked');

        $this->setPolicy(['tanker_fill_attachment_removal' => 'always']);
        $replace($a, 261)->assertCreated();
        $this->setPolicy(['tanker_fill_attachment_after_close' => 'deny']);
        $replace($b, 262)->assertStatus(422)->assertJsonPath('reason', 'attachment_add_blocked');
        $remove($b)->assertOk();

        $this->setPolicy(['tanker_fill_attachment_removal' => 'never', 'tanker_fill_attachment_after_close' => 'allow']);
        $active = FuelTankerFillAttachment::query()->where('status', 'active')->sole();
        $remove($active->id)->assertStatus(422)->assertJsonPath('details.blocked_reason', 'removal_disabled');
        $replace($active->id, 263)->assertStatus(422)->assertJsonPath('details.blocked_reason', 'removal_disabled');
    }

    /** @test */
    public function a_voided_fill_keeps_its_attachments_readable_but_frozen(): void
    {
        $fill = $this->fill();
        $staff = $this->staff();
        $id = $this->upload($staff['token'], $fill, [$this->image()])->assertCreated()->json('data.0.id');
        $this->withToken($staff['token'])->postJson(self::FILLS . "/{$fill->id}/void", ['reason' => 'خطأ إدخال'])->assertOk();

        $state = $this->withToken($staff['token'])->getJson($this->url($fill))->assertOk()->json('meta');
        $this->assertFalse($state['can_add']);
        $this->assertSame('fill_voided', $state['add_blocked_reason']);
        $this->assertSame('fill_voided', $state['remove_blocked_reason']);
        $this->upload($staff['token'], $fill, [$this->image('v.jpg', 140, 100)])->assertStatus(422)->assertJsonPath('details.blocked_reason', 'fill_voided');
        $this->withToken($staff['token'])->deleteJson($this->url($fill, "/{$id}"), ['reason' => 'اختبار'])->assertStatus(422);
        $this->withToken($staff['token'])->get($this->url($fill, "/{$id}/download"))->assertOk();
        $this->assertSame('active', FuelTankerFillAttachment::query()->findOrFail($id)->status);
    }

    /** @test */
    public function the_photo_is_optional_by_default_and_the_required_flag_only_reports_missing_without_blocking_anything(): void
    {
        $staff = $this->staff();
        $fill = $this->fill();

        $default = $this->withToken($staff['token'])->getJson($this->url($fill))->json('meta');
        $this->assertFalse($default['policy']['required']);
        $this->assertSame('never', $default['policy']['required_stage']);
        $this->assertSame('none', $default['status']);

        // تفعيل الإلزام (قرار منفصل لاحق) يُعلن «ناقص» ولا يحجب تسجيل التعبئة ولا إلغاءها ولا الوردية.
        $this->setPolicy(['tanker_voucher_attachment_required' => 'before_shift_approval']);
        $required = $this->withToken($staff['token'])->getJson($this->url($fill))->json('meta');
        $this->assertTrue($required['policy']['required']);
        $this->assertSame('before_shift_approval', $required['policy']['required_stage']);
        $this->assertSame('missing', $required['status']);
        $next = $this->fill('REQ-1');
        $this->assertSame('recorded', $next->status);
        $this->withToken($staff['token'])->postJson(self::FILLS . "/{$next->id}/void", ['reason' => 'اختبار'])->assertOk();

        $this->upload($staff['token'], $fill, [$this->image()])->assertCreated();
        $this->assertSame('present', $this->withToken($staff['token'])->getJson($this->url($fill))->json('meta.status'));
    }

    /** @test */
    public function attachment_policies_are_settings_with_safe_defaults_governance_and_station_inheritance(): void
    {
        $defaults = \App\Support\Settings::DEFAULTS['fuel_stations'];
        $this->assertSame('never', $defaults['tanker_voucher_attachment_required']);
        $this->assertSame('images_and_pdf', $defaults['tanker_fill_attachment_types']);
        $this->assertSame(10, $defaults['tanker_fill_attachment_max_size_mb']);
        $this->assertSame(10, $defaults['tanker_fill_attachment_max_count']);
        $this->assertSame('allow', $defaults['tanker_fill_attachment_after_close']);
        $this->assertSame('open_shift_only', $defaults['tanker_fill_attachment_removal']);

        // الثلاثة الحوكمية تتطلب fuel.governance.manage؛ الأنواع والحجم والعدد تكفيها fuel_stations.manage.
        $manager = $this->makeUser('t5mgr', 'role-t5-mgr', ['fuel_stations.view', 'fuel_stations.manage']);
        foreach (['tanker_voucher_attachment_required' => 'before_settlement', 'tanker_fill_attachment_after_close' => 'deny', 'tanker_fill_attachment_removal' => 'never'] as $key => $value) {
            $this->withToken($manager['token'])->putJson('/api/fuel-stations/settings', [$key => $value, 'reason' => 'اختبار'])->assertForbidden();
        }
        $this->withToken($manager['token'])->putJson('/api/fuel-stations/settings', ['tanker_fill_attachment_max_count' => 4, 'reason' => 'اختبار'])->assertOk();

        // وراثة: افتراضي المؤسسة 4، وتجاوز المحطة 2؛ ومسح التجاوز يعيد الموروث. لا override على مستوى الجهاز.
        $fill = $this->fill();
        $policy = fn () => $this->withToken($this->fx['owner'])->getJson($this->url($fill))->json('meta.policy.max_count');
        $this->assertSame(4, $policy());
        $this->withToken($this->fx['owner'])->putJson("/api/fuel-stations/stations/{$this->fx['s1']->id}/settings", ['tanker_fill_attachment_max_count' => 2, 'reason' => 'تجاوز المحطة'])->assertOk();
        $this->assertSame(2, $policy());
        $this->withToken($this->fx['owner'])->putJson("/api/fuel-stations/stations/{$this->fx['s1']->id}/settings", ['tanker_fill_attachment_max_count' => null, 'reason' => 'العودة للموروث'])->assertOk();
        $this->assertSame(4, $policy());
        $this->expectException(RuntimeException::class);
        app(\App\Services\FuelStationSettingsService::class)->putDevice($this->fx['s1'], 'device-1', 'tanker_fill_attachment_max_count', 3, null, 'اختبار');
    }

    // ───────────────────────── الفشل والتناسق ─────────────────────────

    /** @test */
    public function a_storage_failure_midway_records_nothing_and_leaves_no_orphan_files(): void
    {
        $fill = $this->fill();
        $staff = $this->staff();
        // الملف الأول يُكتب فعلاً ثم تفشل كتابة الثاني: يجب أن يُحذف الأول (كلها أو لا شيء) ولا يُسجَّل صف.
        $real = Storage::disk('local');
        $writes = 0;
        $flaky = \Mockery::mock($real)->makePartial();
        $flaky->shouldReceive('putFileAs')->andReturnUsing(function (...$arguments) use (&$writes, $real) {
            return ++$writes === 2 ? false : $real->putFileAs(...$arguments);
        });
        Storage::set('local', $flaky);

        $this->upload($staff['token'], $fill, [$this->image('a.jpg', 160, 110), $this->image('b.jpg', 161, 111)])->assertStatus(503)->assertJsonPath('reason', 'attachment_storage_failed');
        $this->assertSame(2, $writes);
        $this->assertSame(0, FuelTankerFillAttachment::query()->count());
        $this->assertSame([], $real->allFiles(), 'الملف المكتوب أولاً حُذف تعويضاً');
        $this->assertSame(0, FuelStationAuditEvent::query()->where('action', 'tanker_fill.attachment_added')->count());
    }

    /** @test */
    public function a_database_failure_after_the_files_were_written_removes_them_and_records_nothing(): void
    {
        $fill = $this->fill();
        $staff = $this->staff();
        $this->app->instance(FuelStationAuditTrail::class, new class extends FuelStationAuditTrail {
            public function record(string $action, \Illuminate\Database\Eloquent\Model $subject, ?array $before, ?array $after, ?\App\Models\User $actor = null, ?string $reason = null): ?FuelStationAuditEvent
            {
                throw new RuntimeException('audit store down');
            }
        });
        $this->app->forgetInstance(\App\Services\FuelTankerFillAttachmentService::class);
        $this->withoutExceptionHandling();

        try {
            $this->upload($staff['token'], $fill, [$this->image('a.jpg', 130, 90), $this->image('b.jpg', 131, 91)]);
            $this->fail('كان يجب أن يفشل الرفع.');
        } catch (RuntimeException $exception) {
            $this->assertSame('audit store down', $exception->getMessage());
        }

        $this->assertSame(0, FuelTankerFillAttachment::query()->count());
        $this->assertSame([], Storage::disk('local')->allFiles(), 'لا ملفات يتيمة بعد التراجع');
        $this->assertSame(0, FuelStationAuditEvent::query()->where('action', 'tanker_fill.attachment_added')->count());
    }

    /** @test */
    public function every_successful_action_is_audited_with_the_actor_and_without_internal_paths(): void
    {
        $fill = $this->fill();
        $staff = $this->staff();
        $this->upload($staff['token'], $fill, [$this->image('a.jpg', 135, 95), $this->pdf('b.pdf')])->assertCreated();

        $events = FuelStationAuditEvent::query()->where('action', 'tanker_fill.attachment_added')->get();
        $this->assertCount(2, $events);
        foreach ($events as $event) {
            $this->assertSame($staff['user']->id, $event->actor_id);
            $this->assertSame($fill->id, $event->subject_id);
            $this->assertSame($this->fx['s1']->id, $event->fuel_station_id);
            $this->assertArrayNotHasKey('path', $event->after['attachment']);
            $this->assertArrayNotHasKey('disk', $event->after['attachment']);
        }
    }

    // ───────────────────────── سلامة السجل في القاعدة والنموذج ─────────────────────────

    /** @test */
    public function the_model_and_the_database_refuse_edits_deletes_and_reopening_of_history(): void
    {
        $fill = $this->fill();
        $staff = $this->staff();
        $id = $this->upload($staff['token'], $fill, [$this->image()])->assertCreated()->json('data.0.id');
        $row = FuelTankerFillAttachment::query()->findOrFail($id);

        // النموذج.
        $this->expectThrown(fn () => $row->forceFill(['original_name' => 'x.jpg'])->save(), LogicException::class);
        $this->expectThrown(fn () => $row->forceFill(['sha256' => str_repeat('a', 64)])->save(), LogicException::class);
        $this->expectThrown(fn () => $row->delete(), LogicException::class);

        // القاعدة (SQL خام): تعديل هوية الملف والحذف مرفوضان.
        $this->expectThrown(fn () => DB::transaction(fn () => DB::table('fuel_tanker_fill_attachments')->where('id', $id)->update(['original_name' => 'hacked'])), QueryException::class);
        $this->expectThrown(fn () => DB::transaction(fn () => DB::table('fuel_tanker_fill_attachments')->where('id', $id)->update(['path' => 'elsewhere'])), QueryException::class);
        $this->expectThrown(fn () => DB::transaction(fn () => DB::table('fuel_tanker_fill_attachments')->where('id', $id)->delete()), QueryException::class);
        // لا إزالة بلا سبب/منفّذ، ولا إعادة فتح مُزال.
        $this->expectThrown(fn () => DB::transaction(fn () => DB::table('fuel_tanker_fill_attachments')->where('id', $id)->update(['status' => 'removed'])), QueryException::class);

        $this->withToken($staff['token'])->deleteJson($this->url($fill, "/{$id}"), ['reason' => 'اختبار الإزالة'])->assertOk();
        $this->expectThrown(fn () => DB::transaction(fn () => DB::table('fuel_tanker_fill_attachments')->where('id', $id)->update(['status' => 'active', 'removed_by' => null, 'removed_at' => null, 'removal_reason' => null])), QueryException::class);
        $this->expectThrown(fn () => FuelTankerFillAttachment::query()->findOrFail($id)->forceFill(['status' => 'active'])->save(), LogicException::class);

        // السند الأصلي لا يُحذف أصلاً (لا مرفق ولا بدونه)، ويحرسه مفتاح أجنبي NO ACTION للمرفقات.
        $this->expectThrown(fn () => DB::transaction(fn () => DB::table('fuel_tanker_fills')->where('id', $fill->id)->delete()), QueryException::class);
        $this->assertSame(1, FuelTankerFill::query()->count());
    }

    /** @test */
    public function the_database_allows_only_one_active_attachment_per_content_and_fill(): void
    {
        $fill = $this->fill();
        $staff = $this->staff();
        $id = $this->upload($staff['token'], $fill, [$this->image()])->assertCreated()->json('data.0.id');
        $row = FuelTankerFillAttachment::query()->findOrFail($id);

        $clone = fn () => DB::table('fuel_tanker_fill_attachments')->insert([
            'id' => (string) \Illuminate\Support\Str::uuid(), 'tenant_id' => $row->tenant_id, 'branch_id' => $row->branch_id, 'fuel_tanker_fill_id' => $row->fuel_tanker_fill_id,
            'disk' => 'local', 'path' => 'dup/' . uniqid(), 'original_name' => 'dup.jpg', 'mime_type' => 'image/jpeg', 'size' => 10, 'sha256' => $row->sha256,
            'status' => 'active', 'uploaded_by' => $row->uploaded_by, 'uploaded_at' => now(), 'created_at' => now(), 'updated_at' => now(),
        ]);
        $this->expectThrown(fn () => DB::transaction($clone), QueryException::class);
    }

    /** @test */
    public function the_migration_rollback_refuses_while_attachments_exist(): void
    {
        $fill = $this->fill();
        $this->upload($this->staff()['token'], $fill, [$this->image()])->assertCreated();
        $migration = require base_path('database/migrations/2027_01_26_010000_create_fuel_tanker_fill_attachments.php');

        $this->expectThrown(fn () => $migration->down(), RuntimeException::class);
        $this->assertSame(1, FuelTankerFillAttachment::query()->count());
    }

    // ───────────────────────── الحدود ─────────────────────────

    /** @test */
    public function the_service_and_controller_never_touch_inventory_accounting_invoicing_or_payments(): void
    {
        foreach (['app/Services/FuelTankerFillAttachmentService.php', 'app/Http/Controllers/Api/FuelTankerFillAttachmentController.php', 'app/Models/FuelTankerFillAttachment.php'] as $file) {
            $code = $this->codeWithoutComments(base_path($file));
            foreach (['InventoryService', 'LedgerService', 'InvoiceService', 'PaymentService', 'StockMovement', 'JournalEntry', 'JournalLine', 'FuelSale'] as $forbidden) {
                $this->assertStringNotContainsString($forbidden, $code, "{$file} لا يذكر {$forbidden}");
            }
        }
        // ولا يكتب أي حقل من السند نفسه (الكمية/الفوهة/المضخة/صاحب الصهريج): لا استدعاء حفظ على نموذج السند.
        $service = $this->codeWithoutComments(base_path('app/Services/FuelTankerFillAttachmentService.php'));
        $this->assertStringNotContainsString('FuelTankerFill::create', $service);
        $this->assertDoesNotMatchRegularExpression('/\$(fill|locked)->(forceFill|update|save)\(/', $service);
    }

    private function codeWithoutComments(string $path): string
    {
        $code = '';
        foreach (token_get_all((string) file_get_contents($path)) as $token) {
            if (is_array($token)) {
                if (in_array($token[0], [T_COMMENT, T_DOC_COMMENT], true)) {
                    continue;
                }
                $code .= $token[1];
            } else {
                $code .= $token;
            }
        }

        return $code;
    }

    private function expectThrown(callable $callback, string $class): void
    {
        try {
            $callback();
        } catch (\Throwable $exception) {
            $this->assertInstanceOf($class, $exception, $exception::class . ': ' . $exception->getMessage());

            return;
        }
        $this->fail("كان يجب أن يرمي {$class}.");
    }
}
