<?php

namespace Tests\Feature;

use App\Models\FuelDelivery;
use App\Models\FuelDeliveryAttachment;
use App\Models\FuelStationAuditEvent;
use App\Models\JournalEntry;
use App\Models\StockMovement;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * FUEL-B5.1 — استلام الوقود: مسودة بلا تكلفة، تسجيل التكلفة كسلطة مالية مستقلة، بوابة الاعتماد، مرفقات سند المورد،
 * وسند/كشف PDF-Excel بنسختين (تشغيلية بلا أي مبلغ، ومالية للمخوَّل فقط) — والخادم هو الحَكَم في كلٍّ منها.
 */
class FuelDeliveryCostAndAttachmentsTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use BuildsFuelStaffFixture;

    private const BASE = '/api/fuel-stations';

    /** مبلغ مميَّز يسهل اقتناصه إن تسرّب إلى أي ناتج غير مالي. */
    private const COST = 987654;

    /** @return array{station: array, finance: array, manager: array} */
    private function actors(): array
    {
        $s1 = $this->fx['s1'];
        $station = $this->makeUser('supervisor', 'staff');
        $manager = $this->makeUser('manager', 'staff');
        foreach ([[$station, 'supervisor'], [$manager, 'station_manager']] as [$u, $tpl]) {
            $this->withToken($this->fx['owner'])->putJson(self::BASE.'/staff/'.$u['user']->id, ['template' => $tpl, 'station_ids' => [$s1->id]])->assertOk();
        }
        // مالية: ترى الاستلام + تسجّل التكلفة + ترى التكلفة، بلا أي مفتاح اعتماد.
        $finance = $this->makeUser('finance', 'fin-role', ['fuel_stations.view', 'fuel.delivery.view', 'fuel.delivery.cost.record', 'products.view_cost']);

        return ['station' => $station, 'finance' => $finance, 'manager' => $manager];
    }

    /** @return array<string, mixed> مسودة بلا تكلفة أنشأها موظف المحطة. */
    private function draft(array $station, string $key = 'b51-1', array $extra = []): array
    {
        $payload = $this->deliveryPayload($this->fx['s1'], $this->fx['t1'], $this->fx['wA1'], $key) + $extra;

        return $this->withToken($station['token'])->postJson(self::BASE.'/deliveries', $payload)->assertCreated()->json('data');
    }

    private function pdf(string $name = 'note.pdf', int $kb = 4): UploadedFile
    {
        return UploadedFile::fake()->createWithContent($name, "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 10 10]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n".str_repeat('x', $kb * 10));
    }

    /** @test */
    public function station_staff_create_a_draft_without_cost_and_cost_is_null_not_zero(): void
    {
        $this->buildFixture();
        ['station' => $station] = $this->actors();

        $created = $this->draft($station);
        $this->assertFalse($created['cost_recorded']);
        $this->assertArrayNotHasKey('received_total_cost_minor', $created);
        $row = DB::table('fuel_deliveries')->where('id', $created['id'])->first();
        $this->assertNull($row->received_total_cost_minor);
        $this->assertNull($row->received_unit_cost_minor);
        $this->assertNull($row->cost_recorded_by);
        $this->assertSame(0, StockMovement::count());
        $this->assertSame(0, JournalEntry::count());

        // الإعادة بالمفتاح نفسه تعيد المسودة نفسها (لا مكرر)، وسند المورد المكرر للمورد نفسه مرفوض.
        $this->withToken($station['token'])->postJson(self::BASE.'/deliveries', $this->deliveryPayload($this->fx['s1'], $this->fx['t1'], $this->fx['wA1'], 'b51-1'))->assertOk()->assertJsonPath('data.id', $created['id']);
        $dup = $this->deliveryPayload($this->fx['s1'], $this->fx['t1'], $this->fx['wA1'], 'b51-other');
        $dup['delivery_note_number'] = 'DN-b51-1';
        $this->withToken($station['token'])->postJson(self::BASE.'/deliveries', $dup)->assertStatus(422);
        $this->assertSame(1, FuelDelivery::count());
    }

    /** @test */
    public function sending_a_cost_at_creation_needs_the_financial_authority_and_zero_is_never_a_cost(): void
    {
        $this->buildFixture();
        ['station' => $station, 'finance' => $finance] = $this->actors();

        // موظف المحطة (بلا تسجيل تكلفة) لا يملك تمرير تكلفة عند الإنشاء ولو عرفها.
        $withCost = $this->deliveryPayload($this->fx['s1'], $this->fx['t1'], $this->fx['wA1'], 'b51-c1') + ['received_total_cost_minor' => self::COST];
        $this->withToken($station['token'])->postJson(self::BASE.'/deliveries', $withCost)->assertForbidden();
        $this->assertSame(0, FuelDelivery::count());

        // الصفر والسالب ليسا تكلفة فعلية (التحقق قبل أي أثر).
        foreach ([0, -5] as $bad) {
            $this->withToken($this->fx['owner'])->postJson(self::BASE.'/deliveries', array_merge($withCost, ['received_total_cost_minor' => $bad, 'idempotency_key' => "z{$bad}"]))->assertStatus(422);
        }

        // المالك (سلطة مالية) يمررها، وتُسجَّل له مع الفاعل والوقت.
        $created = $this->withToken($this->fx['owner'])->postJson(self::BASE.'/deliveries', $withCost)->assertCreated()->json('data');
        $this->assertSame(self::COST, $created['received_total_cost_minor']);
        $this->assertNotNull(DB::table('fuel_deliveries')->where('id', $created['id'])->value('cost_recorded_by'));
    }

    /** @test */
    public function cost_recording_is_a_separate_financial_action_with_its_own_permission_and_view_cost(): void
    {
        $this->buildFixture();
        ['station' => $station, 'finance' => $finance, 'manager' => $manager] = $this->actors();
        $draft = $this->draft($station);
        $url = self::BASE.'/deliveries/'.$draft['id'].'/cost';

        // موظف المحطة والمدير (يعتمد لكنه بلا view_cost) لا يسجلان التكلفة؛ ومن يملك view_cost وحده بلا مفتاح التكلفة كذلك.
        $this->withToken($station['token'])->postJson($url, ['received_total_cost_minor' => self::COST])->assertForbidden();
        $this->withToken($manager['token'])->postJson($url, ['received_total_cost_minor' => self::COST])->assertForbidden();
        $viewOnly = $this->makeUser('viewcost', 'viewcost-role', ['fuel_stations.view', 'fuel.delivery.view', 'products.view_cost']);
        $this->withToken($viewOnly['token'])->postJson($url, ['received_total_cost_minor' => self::COST])->assertForbidden();
        $keyOnly = $this->makeUser('keyonly', 'keyonly-role', ['fuel_stations.view', 'fuel.delivery.view', 'fuel.delivery.cost.record']);
        $this->withToken($keyOnly['token'])->postJson($url, ['received_total_cost_minor' => self::COST])->assertForbidden();
        $this->assertNull(DB::table('fuel_deliveries')->where('id', $draft['id'])->value('received_total_cost_minor'));

        // قيم غير صالحة.
        foreach ([0, -1, 'abc', 12.5, null] as $bad) {
            $this->withToken($finance['token'])->postJson($url, ['received_total_cost_minor' => $bad])->assertStatus(422);
        }

        // المالية تسجّل: النتيجة تُرى لها ولا تُرى للموظف، ولا أثر مخزني/محاسبي.
        $ok = $this->withToken($finance['token'])->postJson($url, ['received_total_cost_minor' => self::COST])->assertOk()->json('data');
        $this->assertSame(self::COST, $ok['received_total_cost_minor']);
        $this->assertTrue($ok['cost_recorded']);
        $this->assertSame($finance['user']->id, $ok['cost_recorded_by']);
        $this->assertSame(0, StockMovement::count());
        $this->assertSame(0, JournalEntry::count());
        $this->assertSame(self::COST, (int) DB::table('fuel_deliveries')->where('id', $draft['id'])->value('received_total_cost_minor'));
        $this->assertSame(intdiv(self::COST, 10000), (int) DB::table('fuel_deliveries')->where('id', $draft['id'])->value('received_unit_cost_minor'));

        $seen = $this->withToken($station['token'])->getJson(self::BASE.'/deliveries/'.$draft['id'])->assertOk()->json('data');
        $this->assertTrue($seen['cost_recorded']);
        foreach (['received_total_cost_minor', 'cost_recorded_by', 'cost_recorded_at'] as $k) {
            $this->assertArrayNotHasKey($k, $seen);
        }
        $this->assertStringNotContainsString((string) self::COST, json_encode($this->withToken($station['token'])->getJson(self::BASE.'/deliveries')->json()));
    }

    /** @test */
    public function the_cost_audit_records_actor_and_time_but_never_the_amount_and_a_replay_is_silent(): void
    {
        $this->buildFixture();
        ['station' => $station, 'finance' => $finance] = $this->actors();
        $draft = $this->draft($station);
        $url = self::BASE.'/deliveries/'.$draft['id'].'/cost';

        $this->withToken($finance['token'])->postJson($url, ['received_total_cost_minor' => self::COST])->assertOk();
        $this->withToken($finance['token'])->postJson($url, ['received_total_cost_minor' => self::COST])->assertOk(); // نفس القيمة: لا حدث ثانٍ
        $events = FuelStationAuditEvent::where('action', 'fuel_delivery.cost_recorded')->get();
        $this->assertCount(1, $events);
        $this->assertSame($finance['user']->id, $events->first()->actor_id);
        $this->assertSame($draft['id'], $events->first()->subject_id);
        $this->assertStringNotContainsString((string) self::COST, json_encode($events->first()->toArray()));

        // تصحيح قبل الاعتماد يُدقَّق مرة أخرى (بلا مبلغ أيضاً).
        $this->withToken($finance['token'])->postJson($url, ['received_total_cost_minor' => self::COST + 100])->assertOk();
        $all = FuelStationAuditEvent::where('action', 'fuel_delivery.cost_recorded')->get();
        $this->assertCount(2, $all);
        $this->assertStringNotContainsString((string) (self::COST + 100), json_encode($all->toArray()));
    }

    /** @test */
    public function approval_is_refused_without_cost_with_no_stock_or_ledger_effect_then_applies_once(): void
    {
        $this->buildFixture();
        ['station' => $station, 'finance' => $finance, 'manager' => $manager] = $this->actors();
        config(['fuel_stations.distinct_approver_cutover_at' => '2000-01-01T00:00:00Z']);
        $draft = $this->draft($station);

        $movements = StockMovement::count();
        $entries = JournalEntry::count();
        $r = $this->withToken($manager['token'])->postJson(self::BASE.'/deliveries/'.$draft['id'].'/approve')->assertStatus(422);
        $this->assertStringContainsString('FUEL_DELIVERY_COST_REQUIRED', (string) $r->json('message'));
        $this->assertSame('draft', DB::table('fuel_deliveries')->where('id', $draft['id'])->value('status'));
        $this->assertSame($movements, StockMovement::count());
        $this->assertSame($entries, JournalEntry::count());

        $this->withToken($finance['token'])->postJson(self::BASE.'/deliveries/'.$draft['id'].'/cost', ['received_total_cost_minor' => self::COST])->assertOk();
        $this->assertSame($movements, StockMovement::count()); // التكلفة وحدها لا تُحرّك شيئاً

        $this->withToken($manager['token'])->postJson(self::BASE.'/deliveries/'.$draft['id'].'/approve')->assertOk()->assertJsonPath('data.status', 'approved');
        $this->assertSame($movements + 1, StockMovement::count());
        $this->assertSame($entries + 1, JournalEntry::count());
        $this->assertSame(self::COST, (int) JournalEntry::latest('created_at')->first()->lines()->sum('debit'));

        // اعتماد ثانٍ لا أثر له، وتعديل التكلفة بعد الاعتماد ممنوع.
        $this->withToken($manager['token'])->postJson(self::BASE.'/deliveries/'.$draft['id'].'/approve')->assertStatus(422);
        $locked = $this->withToken($finance['token'])->postJson(self::BASE.'/deliveries/'.$draft['id'].'/cost', ['received_total_cost_minor' => 1])->assertStatus(422);
        $this->assertStringContainsString('FUEL_DELIVERY_COST_LOCKED', (string) $locked->json('message'));
        $this->assertSame(self::COST, (int) DB::table('fuel_deliveries')->where('id', $draft['id'])->value('received_total_cost_minor'));
        $this->assertSame($movements + 1, StockMovement::count());
        $this->assertSame($entries + 1, JournalEntry::count());
    }

    /** @test */
    public function the_distinct_approver_policy_still_applies_to_a_costed_draft(): void
    {
        $this->buildFixture();
        ['finance' => $finance, 'manager' => $manager] = $this->actors();
        config(['fuel_stations.distinct_approver_cutover_at' => '2000-01-01T00:00:00Z']);
        $draft = $this->draft($manager, 'b51-sod');
        $this->withToken($finance['token'])->postJson(self::BASE.'/deliveries/'.$draft['id'].'/cost', ['received_total_cost_minor' => self::COST])->assertOk();

        $r = $this->withToken($manager['token'])->postJson(self::BASE.'/deliveries/'.$draft['id'].'/approve')->assertStatus(422);
        $this->assertStringContainsString('FUEL_DISTINCT_APPROVER_REQUIRED', (string) $r->json('message'));
        $this->assertSame(0, StockMovement::count());
    }

    /** @test */
    public function an_approver_who_saw_the_cost_cannot_approve_a_different_one_and_cost_blind_users_cannot_probe_it(): void
    {
        $this->buildFixture();
        ['station' => $station, 'finance' => $finance, 'manager' => $manager] = $this->actors();
        $draft = $this->draft($station);
        $this->withToken($finance['token'])->postJson(self::BASE.'/deliveries/'.$draft['id'].'/cost', ['received_total_cost_minor' => self::COST])->assertOk();

        // المعتمِد الأعمى عن التكلفة لا يرسل قيمة متوقعة (وإلا صارت قناة تخمين).
        $this->withToken($manager['token'])->postJson(self::BASE.'/deliveries/'.$draft['id'].'/approve', ['expected_total_cost_minor' => self::COST])->assertForbidden();
        $this->assertSame('draft', DB::table('fuel_deliveries')->where('id', $draft['id'])->value('status'));

        // معتمِد يرى التكلفة: تغيّرت بعد مراجعته ⇒ 409 بلا أثر؛ ثم يعتمد المطابقة.
        $approver = $this->makeUser('approver-cost', 'appr-cost', [...$this->managerPermissions(), 'products.view_cost'], [$this->fx['s1']->id]);
        $before = StockMovement::count();
        $r = $this->withToken($approver['token'])->postJson(self::BASE.'/deliveries/'.$draft['id'].'/approve', ['expected_total_cost_minor' => self::COST + 1])->assertStatus(409);
        $this->assertStringContainsString('FUEL_DELIVERY_COST_CHANGED', (string) $r->json('message'));
        $this->assertSame($before, StockMovement::count());
        $this->withToken($approver['token'])->postJson(self::BASE.'/deliveries/'.$draft['id'].'/approve', ['expected_total_cost_minor' => self::COST])->assertOk();
        $this->assertSame($before + 1, StockMovement::count());
    }

    /** @test */
    public function approval_needs_a_delivery_note_number_or_an_attachment(): void
    {
        Storage::fake('local');
        $this->buildFixture();
        ['station' => $station, 'manager' => $manager] = $this->actors();
        config(['fuel_stations.distinct_approver_cutover_at' => '2000-01-01T00:00:00Z']);
        $payload = $this->deliveryPayload($this->fx['s1'], $this->fx['t1'], $this->fx['wA1'], 'b51-nodoc');
        unset($payload['delivery_note_number']);
        $draft = $this->withToken($station['token'])->postJson(self::BASE.'/deliveries', $payload)->assertCreated()->json('data');
        $this->setCostDirectly($draft['id']);

        $r = $this->withToken($manager['token'])->postJson(self::BASE.'/deliveries/'.$draft['id'].'/approve')->assertStatus(422);
        $this->assertStringContainsString('FUEL_DELIVERY_DOCUMENT_REQUIRED', (string) $r->json('message'));

        $this->withToken($station['token'])->post(self::BASE.'/deliveries/'.$draft['id'].'/attachments', ['attachments' => [$this->pdf()]], ['Accept' => 'application/json'])->assertCreated();
        $this->withToken($manager['token'])->postJson(self::BASE.'/deliveries/'.$draft['id'].'/approve')->assertOk();
    }

    /** @test */
    public function legacy_costed_drafts_and_approved_rows_keep_working(): void
    {
        $this->buildFixture();
        ['manager' => $manager] = $this->actors();
        config(['fuel_stations.distinct_approver_cutover_at' => null]);
        // استلام قديم: تكلفة موجودة، بلا cost_recorded_by (قبل B5.1)، وبرقم سند.
        $draft = $this->withToken($this->fx['owner'])->postJson(self::BASE.'/deliveries', $this->deliveryPayload($this->fx['s1'], $this->fx['t1'], $this->fx['wA1'], 'b51-legacy') + ['received_total_cost_minor' => 2345])->assertCreated()->json('data');
        DB::table('fuel_deliveries')->where('id', $draft['id'])->update(['cost_recorded_by' => null, 'cost_recorded_at' => null]);

        $this->withToken($manager['token'])->postJson(self::BASE.'/deliveries/'.$draft['id'].'/approve')->assertOk()->assertJsonPath('data.status', 'approved');
        $shown = $this->withToken($this->fx['owner'])->getJson(self::BASE.'/deliveries/'.$draft['id'])->assertOk()->json('data');
        $this->assertSame(2345, $shown['received_total_cost_minor']);
        $this->assertNull($shown['cost_recorded_by']);
    }

    /** @test */
    public function idempotent_replay_tolerates_a_cost_recorded_in_between(): void
    {
        $this->buildFixture();
        ['station' => $station, 'finance' => $finance] = $this->actors();
        $payload = $this->deliveryPayload($this->fx['s1'], $this->fx['t1'], $this->fx['wA1'], 'b51-replay');
        $first = $this->withToken($station['token'])->postJson(self::BASE.'/deliveries', $payload)->assertCreated()->json('data');
        $this->withToken($finance['token'])->postJson(self::BASE.'/deliveries/'.$first['id'].'/cost', ['received_total_cost_minor' => self::COST])->assertOk();

        // انقطع رد الإنشاء فأعاد الموظف الطلب نفسه بعد تسجيل المالية للتكلفة: يعود السجل نفسه بلا تعارض ولا مكرر.
        $this->withToken($station['token'])->postJson(self::BASE.'/deliveries', $payload)->assertOk()->assertJsonPath('data.id', $first['id']);
        $this->assertSame(1, FuelDelivery::count());
        // أما تغيير محتوى حقيقي بالمفتاح نفسه فيبقى مرفوضاً.
        $this->withToken($station['token'])->postJson(self::BASE.'/deliveries', ['received_liters' => '11.000'] + $payload)->assertStatus(422);
    }

    // ───────────── المرفقات ─────────────

    /** @test */
    public function attachments_upload_list_download_dedupe_and_delete_for_drafts_only(): void
    {
        Storage::fake('local');
        $this->buildFixture();
        ['station' => $station, 'manager' => $manager, 'finance' => $finance] = $this->actors();
        config(['fuel_stations.distinct_approver_cutover_at' => '2000-01-01T00:00:00Z']);
        $draft = $this->draft($station);
        $base = self::BASE.'/deliveries/'.$draft['id'].'/attachments';
        $accept = ['Accept' => 'application/json'];

        $created = $this->withToken($station['token'])->post($base, ['attachments' => [$this->pdf('سند.pdf')]], $accept)->assertCreated()->json('data');
        $this->assertCount(1, $created);
        $id = $created[0]['id'];
        $this->assertSame('application/pdf', $created[0]['mime_type']);

        // إعادة رفع المحتوى نفسه (بعد انقطاع الرد) لا تُكرّر الملف ولا الصف.
        $again = $this->withToken($station['token'])->post($base, ['attachments' => [$this->pdf('نسخة.pdf')]], $accept)->assertCreated()->json('data');
        $this->assertSame($id, $again[0]['id']);
        $this->assertSame(1, FuelDeliveryAttachment::count());
        $this->assertCount(1, Storage::disk('local')->allFiles());

        $listed = $this->withToken($station['token'])->getJson($base)->assertOk()->json('data');
        $this->assertCount(1, $listed);
        $this->assertArrayNotHasKey('path', $listed[0]);
        $this->assertArrayNotHasKey('disk', $listed[0]);
        $show = $this->withToken($station['token'])->getJson(self::BASE.'/deliveries/'.$draft['id'])->assertOk()->json('data');
        $this->assertSame(1, $show['attachments_count']);

        $dl = $this->withToken($station['token'])->get($base.'/'.$id.'/download');
        $dl->assertOk();
        $this->assertSame('application/pdf', $dl->headers->get('Content-Type'));
        $this->assertSame('nosniff', $dl->headers->get('X-Content-Type-Options'));

        // المالية (قراءة فقط) تقرأ ولا ترفع ولا تحذف.
        $this->withToken($finance['token'])->get($base.'/'.$id.'/download')->assertOk();
        $this->withToken($finance['token'])->post($base, ['attachments' => [$this->pdf('x.pdf', 9)]], $accept)->assertForbidden();
        $this->withToken($finance['token'])->deleteJson($base.'/'.$id)->assertForbidden();

        // حذف المسودة يزيل الصف والملف؛ وبعد الاعتماد لا حذف.
        $this->withToken($station['token'])->deleteJson($base.'/'.$id)->assertNoContent();
        $this->assertSame(0, FuelDeliveryAttachment::count());
        $this->assertCount(0, Storage::disk('local')->allFiles());

        $kept = $this->withToken($station['token'])->post($base, ['attachments' => [$this->pdf('keep.pdf', 7)]], $accept)->assertCreated()->json('data');
        $this->setCostDirectly($draft['id']);
        $this->withToken($manager['token'])->postJson(self::BASE.'/deliveries/'.$draft['id'].'/approve')->assertOk();
        $this->withToken($station['token'])->deleteJson($base.'/'.$kept[0]['id'])->assertStatus(422);
        $this->assertSame(1, FuelDeliveryAttachment::count());
    }

    /** @test */
    public function attachment_uploads_validate_real_content_type_and_size(): void
    {
        Storage::fake('local');
        $this->buildFixture();
        ['station' => $station] = $this->actors();
        $draft = $this->draft($station);
        $base = self::BASE.'/deliveries/'.$draft['id'].'/attachments';
        $accept = ['Accept' => 'application/json'];

        // امتداد pdf ومحتوى غير PDF؛ وسكربت بامتداد صورة؛ وSVG/نص/HTML؛ كلها 422 بلا أي ملف مكتوب.
        foreach ([
            UploadedFile::fake()->createWithContent('fake.pdf', '<?php echo 1;'),
            UploadedFile::fake()->createWithContent('shell.jpg', "<?php system('id');"),
            UploadedFile::fake()->createWithContent('a.svg', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
            UploadedFile::fake()->createWithContent('a.html', '<html><script>alert(1)</script></html>'),
            UploadedFile::fake()->createWithContent('empty.pdf', ''),
        ] as $bad) {
            $this->withToken($station['token'])->post($base, ['attachments' => [$bad]], $accept)->assertStatus(422);
        }
        $this->withToken($station['token'])->post($base, ['attachments' => [UploadedFile::fake()->create('big.pdf', 11 * 1024, 'application/pdf')]], $accept)->assertStatus(422);
        $this->withToken($station['token'])->post($base, [], $accept)->assertStatus(422);
        $this->assertSame(0, FuelDeliveryAttachment::count());
        $this->assertCount(0, Storage::disk('local')->allFiles());

        // صورة PNG حقيقية تُقبل.
        $png = UploadedFile::fake()->image('photo.png', 40, 30);
        $this->withToken($station['token'])->post($base, ['attachments' => [$png]], $accept)->assertCreated()->assertJsonPath('data.0.mime_type', 'image/png');
    }

    /** @test */
    public function attachments_respect_station_scope_and_tenant_isolation(): void
    {
        Storage::fake('local');
        $this->buildFixture();
        ['station' => $station] = $this->actors();
        $other = $this->withToken($this->fx['owner'])->postJson(self::BASE.'/deliveries', $this->deliveryPayload($this->fx['s2'], $this->fx['t2'], $this->fx['wA2'], 'b51-other'))->assertCreated()->json('data');
        $accept = ['Accept' => 'application/json'];
        $this->withToken($this->fx['owner'])->post(self::BASE.'/deliveries/'.$other['id'].'/attachments', ['attachments' => [$this->pdf('o.pdf')]], $accept)->assertCreated();
        $attId = FuelDeliveryAttachment::firstOrFail()->id;

        // موظف المحطة (المحطة 1 فقط) لا يرى ولا يرفع ولا ينزّل لاستلام المحطة 2 (404 موحَّد).
        $base = self::BASE.'/deliveries/'.$other['id'].'/attachments';
        $this->withToken($station['token'])->getJson($base)->assertNotFound();
        $this->withToken($station['token'])->post($base, ['attachments' => [$this->pdf('p.pdf', 6)]], $accept)->assertNotFound();
        $this->withToken($station['token'])->get($base.'/'.$attId.'/download')->assertNotFound();
        $this->withToken($station['token'])->deleteJson($base.'/'.$attId)->assertNotFound();

        // مستأجر آخر لا يصل لشيء.
        $this->flushHeaders();
        $foreign = $this->registerTenant('fuel-b51-foreign', 'o@fuel-b51-foreign.test', autoEnableApplications: true);
        // (تطبيق الوقود غير مفعَّل له ⇒ 403؛ وحتى لو فُعِّل فالمعرّف غير موجود في نطاقه ⇒ 404) — المهم ألا يصل لشيء.
        $this->assertContains($this->withToken($foreign['token'])->getJson($base)->getStatusCode(), [403, 404]);
        $this->assertContains($this->withToken($foreign['token'])->get($base.'/'.$attId.'/download')->getStatusCode(), [403, 404]);
    }

    // ───────────── السند والكشف (PDF يُرسم في المتصفح من هذه الحمولة + Excel من الخادم) ─────────────

    /** @return list<string> */
    private function keysDeep(mixed $data, string $prefix = ''): array
    {
        $out = [];
        if (is_array($data)) {
            foreach ($data as $k => $v) {
                $path = $prefix.(is_string($k) ? $k : '*');
                $out[] = $path;
                array_push($out, ...$this->keysDeep($v, $path.'.'));
            }
        }

        return $out;
    }

    /** @test */
    public function the_operational_document_and_report_contain_no_price_or_cost_key_or_amount_and_financial_is_403_for_the_unauthorized(): void
    {
        $this->buildFixture();
        ['station' => $station, 'finance' => $finance] = $this->actors();
        $draft = $this->draft($station);
        $this->withToken($finance['token'])->postJson(self::BASE.'/deliveries/'.$draft['id'].'/cost', ['received_total_cost_minor' => self::COST])->assertOk();

        foreach (["/deliveries/{$draft['id']}/document", '/deliveries/report'] as $path) {
            // موظف المحطة: تشغيلية فقط. المالية 403. النسخة المجهولة 422.
            $op = $this->withToken($station['token'])->getJson(self::BASE.$path)->assertOk();
            $json = json_encode($op->json());
            $this->assertStringNotContainsString((string) self::COST, $json);
            $this->assertStringNotContainsString('9876', $json);
            $this->assertSame('operational', $op->json('data.variant'));
            foreach ($this->keysDeep($op->json('data')) as $key) {
                $this->assertDoesNotMatchRegularExpression('/cost|price|value|amount|total_minor/i', $key, "مفتاح مالي في النسخة التشغيلية: {$key}");
            }
            $this->withToken($station['token'])->getJson(self::BASE.$path.'?variant=financial')->assertForbidden();
            $this->withToken($station['token'])->getJson(self::BASE.$path.'?variant=bogus')->assertStatus(422);
        }

        // المخوَّل (يرى التكلفة) يحصل على المالية بالمبلغ نفسه، والتشغيلية تبقى بلا مبلغ حتى له.
        $fin = $this->withToken($finance['token'])->getJson(self::BASE."/deliveries/{$draft['id']}/document?variant=financial")->assertOk()->json('data');
        $this->assertSame(self::COST, $fin['cost']['total_minor']);
        $this->assertSame($finance['user']->name, $fin['cost']['recorded_by']);
        $rep = $this->withToken($finance['token'])->getJson(self::BASE.'/deliveries/report?variant=financial')->assertOk()->json('data');
        $this->assertSame(self::COST, $rep['totals']['total_cost_minor']);
        $this->assertStringNotContainsString((string) self::COST, json_encode($this->withToken($finance['token'])->getJson(self::BASE."/deliveries/{$draft['id']}/document")->json()));
    }

    /** @test */
    public function the_document_carries_company_station_supplier_quantities_variance_and_signers(): void
    {
        $this->buildFixture();
        ['station' => $station, 'finance' => $finance, 'manager' => $manager] = $this->actors();
        config(['fuel_stations.distinct_approver_cutover_at' => '2000-01-01T00:00:00Z']);
        $created = $this->withToken($station['token'])->postJson(self::BASE.'/deliveries', ['dispatched_liters' => '10.000', 'received_liters' => '9.500'] + $this->deliveryPayload($this->fx['s1'], $this->fx['t1'], $this->fx['wA1'], 'b51-doc'))->assertCreated()->json('data');
        $this->withToken($finance['token'])->postJson(self::BASE.'/deliveries/'.$created['id'].'/cost', ['received_total_cost_minor' => 9500])->assertOk();
        $this->withToken($manager['token'])->postJson(self::BASE.'/deliveries/'.$created['id'].'/approve')->assertOk();

        $doc = $this->withToken($station['token'])->getJson(self::BASE."/deliveries/{$created['id']}/document")->assertOk()->json('data');
        $this->assertSame('FD-'.strtoupper(substr($created['id'], 0, 8)), $doc['reference']);
        $this->assertNotEmpty($doc['company']['name']);
        $this->assertSame($this->fx['s1']->name, $doc['station']['name']);
        $this->assertSame('مورد B3', $doc['supplier']['name']);
        $this->assertSame('T-B3S1', $doc['tank']['code']);
        $this->assertSame('10', $doc['quantities']['dispatched_liters']);
        $this->assertSame('9.5', $doc['quantities']['received_liters']);
        $this->assertSame('-0.5', $doc['quantities']['transit_variance_liters']);
        $this->assertSame('-5.00', $doc['quantities']['transit_variance_percent']);
        $this->assertSame($station['user']->name, $doc['received_by']);
        $this->assertSame($manager['user']->name, $doc['approved_by']);
        $this->assertSame('approved', $doc['status']);

        $fin = $this->withToken($finance['token'])->getJson(self::BASE."/deliveries/{$created['id']}/document?variant=financial")->assertOk()->json('data');
        $this->assertSame('10.0000', $fin['cost']['per_liter']); // 95.00 ريال ÷ 9.5 لتر
    }

    /** @test */
    public function excel_exports_are_server_enforced_per_variant_and_never_carry_cost_in_the_operational_file(): void
    {
        $this->buildFixture();
        ['station' => $station, 'finance' => $finance] = $this->actors();
        $draft = $this->draft($station);
        $this->withToken($finance['token'])->postJson(self::BASE.'/deliveries/'.$draft['id'].'/cost', ['received_total_cost_minor' => self::COST])->assertOk();

        $xlsxText = function ($response): string {
            $this->assertStringContainsString('spreadsheetml.sheet', (string) $response->headers->get('Content-Type'));
            $tmp = tempnam(sys_get_temp_dir(), 'xl');
            file_put_contents($tmp, $response->getContent());
            $zip = new \ZipArchive();
            $this->assertTrue($zip->open($tmp));
            $text = '';
            for ($i = 0; $i < $zip->numFiles; $i++) {
                $text .= $zip->getFromIndex($i);
            }
            $zip->close();
            @unlink($tmp);

            return $text;
        };

        foreach (["/deliveries/{$draft['id']}/export", '/deliveries/export'] as $path) {
            $op = $this->withToken($station['token'])->get(self::BASE.$path);
            $op->assertOk();
            $text = $xlsxText($op);
            $this->assertStringNotContainsString('9876.54', $text);
            $this->assertStringNotContainsString('987654', $text);
            $this->assertStringNotContainsString('التكلفة', $text);
            $this->assertStringContainsString('DN-b51-1', $text);
            $this->withToken($station['token'])->get(self::BASE.$path.'?variant=financial')->assertForbidden();

            $fin = $this->withToken($finance['token'])->get(self::BASE.$path.'?variant=financial');
            $fin->assertOk();
            $this->assertStringContainsString('9876.54', $xlsxText($fin));
        }
    }

    /** @test */
    public function search_and_filters_work_on_list_report_and_export_within_scope(): void
    {
        $this->buildFixture();
        ['station' => $station] = $this->actors();
        $a = $this->draft($station, 'b51-s-a');
        $b = $this->withToken($this->fx['owner'])->postJson(self::BASE.'/deliveries', ['delivery_note_number' => 'XYZ-777'] + $this->deliveryPayload($this->fx['s1'], $this->fx['t1'], $this->fx['wA1'], 'b51-s-b'))->assertCreated()->json('data');
        // استلام في محطة أخرى لا يظهر لموظف المحطة 1 مهما كان البحث.
        $this->withToken($this->fx['owner'])->postJson(self::BASE.'/deliveries', ['delivery_note_number' => 'XYZ-888'] + $this->deliveryPayload($this->fx['s2'], $this->fx['t2'], $this->fx['wA2'], 'b51-s-c'))->assertCreated();

        $ids = fn (string $qs) => collect($this->withToken($station['token'])->getJson(self::BASE.'/deliveries'.$qs)->assertOk()->json('data'))->pluck('id')->all();
        $this->assertEqualsCanonicalizing([$a['id'], $b['id']], $ids(''));
        $this->assertSame([$b['id']], $ids('?q='.urlencode('xyz-7')));
        $this->assertSame([], $ids('?q='.urlencode('XYZ-888'))); // خارج النطاق
        $this->assertSame([$a['id']], $ids('?cost=missing&status=draft&supplier_id='.$this->fx['supplier']->id.'&q='.urlencode('DN-b51-s-a')));
        $this->assertEqualsCanonicalizing([$a['id'], $b['id']], $ids('?from='.now()->subDay()->toDateString().'&to='.now()->addDay()->toDateString()));
        $this->assertSame([], $ids('?from='.now()->addDays(2)->toDateString()));
        $this->withToken($station['token'])->getJson(self::BASE.'/deliveries?status=bogus')->assertStatus(422);
        $this->withToken($station['token'])->getJson(self::BASE.'/deliveries?to=2020-01-01&from=2021-01-01')->assertStatus(422);

        $report = $this->withToken($station['token'])->getJson(self::BASE.'/deliveries/report?q='.urlencode('XYZ'))->assertOk()->json('data');
        $this->assertSame(1, $report['totals']['count']);
        $this->assertSame('XYZ-777', $report['rows'][0]['delivery_note_number']);
        $this->assertSame(['q' => 'XYZ'], $report['filters']);
    }

    /** @test */
    public function document_and_export_respect_station_scope_and_reading_permissions(): void
    {
        $this->buildFixture();
        ['station' => $station] = $this->actors();
        $other = $this->withToken($this->fx['owner'])->postJson(self::BASE.'/deliveries', $this->deliveryPayload($this->fx['s2'], $this->fx['t2'], $this->fx['wA2'], 'b51-doc-other'))->assertCreated()->json('data');
        $seller = $this->makeUser('seller', 'staff');
        $this->withToken($this->fx['owner'])->putJson(self::BASE.'/staff/'.$seller['user']->id, ['template' => 'seller', 'station_ids' => [$this->fx['s1']->id]])->assertOk();

        $this->withToken($station['token'])->getJson(self::BASE."/deliveries/{$other['id']}/document")->assertNotFound();
        $this->withToken($station['token'])->get(self::BASE."/deliveries/{$other['id']}/export")->assertNotFound();
        // البائع يحمل `fuel_stations.view` القديمة فيقرأ الاستلامات تشغيلياً (كالقائمة قبل B5.1) — لكنه لا يصل للنسخة المالية أبداً.
        foreach (['/deliveries/report', '/deliveries/export'] as $p) {
            $this->withToken($seller['token'])->get(self::BASE.$p)->assertOk();
            $this->withToken($seller['token'])->get(self::BASE.$p.'?variant=financial')->assertForbidden();
        }
        $this->withToken($seller['token'])->getJson(self::BASE."/deliveries/{$other['id']}/document")->assertNotFound(); // محطة أخرى
    }
}
