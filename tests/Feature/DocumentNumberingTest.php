<?php

namespace Tests\Feature;

use App\Models\Employee;
use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\Partner;
use App\Models\Tenant;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\InvoiceService;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  طبقة الترقيم الموحَّدة — `GeneratesDocumentNumbers`
 * ═══════════════════════════════════════════════════════════════
 *  تغطّي العيبين اللذين كشفهما فحصُ الترقيم ولم يكن لهما اختبار قطّ:
 *
 *   • **`count()+1` والحذف:** حذف مستند من وسط السلسلة كان يُعيد إنتاج رقمٍ
 *     موجود فيُقفل السنة كلها — كل إنشاء لاحق يفشل بلا تعافٍ.
 *   • **التزامن:** توليدٌ بلا قفلٍ يُنتج الرقم نفسه لطلبين متوازيين.
 *
 *  ويضاف إليهما استقلال سلاسل الفروع، وبقاء عدّاد ZATCA على مستوى المستأجر.
 *
 *  تشغيل: php artisan test --filter=DocumentNumberingTest
 */
class DocumentNumberingTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    protected Tenant $tenant;
    protected Partner $customer;

    /** مستأجر المِرساة في اختبار التزامن — يُنشأ خارج معاملة الاختبار فيُنظَّف يدوياً. */
    protected ?string $anchorTenantId = null;

    protected function tearDown(): void
    {
        $anchorId = $this->anchorTenantId;

        // بعد `parent::tearDown()` حصراً: هناك تتراجع معاملة الاختبار فيتحرّر
        // القفل. وقبلها يُحجب الحذف بالقفل نفسه الذي يختبره الاختبار.
        parent::tearDown();

        if ($anchorId !== null) {
            DB::connection('rival')->table('tenants')->where('id', $anchorId)->delete();
            DB::connection('rival')->disconnect();
        }
    }

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenant = Tenant::create([
            'name'       => 'نبراس الطموح',
            'slug'       => 'nibras',
            'vat_number' => '300000000000003',
            'currency'   => 'SAR',
        ]);

        app(TenantContext::class)->set($this->tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);

        $this->customer = Partner::create(['name' => 'عميل', 'type' => 'customer']);
    }

    private function invoice(string $date = '2026-03-01'): Invoice
    {
        return app(InvoiceService::class)->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash', 'invoice_date' => $date],
            [['description' => 'منتج', 'quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]]
        );
    }

    // ═══════════════════════════════════════════════════════════
    //  العيب الأول: الحذف من وسط السلسلة
    // ═══════════════════════════════════════════════════════════

    /**
     * الحذف من الوسط كان قاتلاً مع `count()+1`: خمس فواتير، تُحذف الثالثة،
     * فيصير العدّ ٤ والرقم التالي `00005` — وهو **موجود**. فيفشل كل إنشاء
     * لاحق في تلك السنة إلى الأبد. `max()+1` لا يرى الثغرة أصلاً.
     *
     * @test
     */
    public function deleting_from_the_middle_does_not_block_later_documents(): void
    {
        $created = [];
        for ($i = 0; $i < 5; $i++) {
            $created[] = $this->invoice();
        }

        $this->assertSame('INV-2026-00005', $created[4]->number);

        // تُحذف الثالثة — تبقى ثغرة في وسط السلسلة.
        app(InvoiceService::class)->deleteDraft($created[2]);

        // مع `count()+1` كان هذا يفشل بانتهاك القيد الفريد.
        $next = $this->invoice();

        $this->assertSame('INV-2026-00006', $next->number);
        $this->assertDatabaseMissing('invoices', ['number' => 'INV-2026-00003']);
    }

    /**
     * حذف **آخر** مستند يحرّر رقمه فيُعاد استعماله — سلوكٌ مقصود في `max()+1`
     * ومطابقٌ لما تفعله `Branch::nextCode()` منذ البداية.
     *
     * @test
     */
    public function deleting_the_last_document_frees_its_number(): void
    {
        $this->invoice();
        $second = $this->invoice();
        $this->assertSame('INV-2026-00002', $second->number);

        app(InvoiceService::class)->deleteDraft($second);

        $this->assertSame('INV-2026-00002', $this->invoice()->number);
    }

    /** السنة تُعيد ضبط السلسلة، ولا تختلط سنة بأخرى. @test */
    public function each_year_restarts_its_own_series(): void
    {
        $this->assertSame('INV-2026-00001', $this->invoice('2026-05-01')->number);
        $this->assertSame('INV-2027-00001', $this->invoice('2027-01-02')->number);
        $this->assertSame('INV-2026-00002', $this->invoice('2026-06-01')->number);
    }

    /**
     * تجاوز خمس خانات: الترتيب المعجمي وحده يعيد `99999` لأن «١» تسبق «٩».
     * الترتيب بالطول أولاً هو ما يحسمها.
     *
     * @test
     */
    public function the_sequence_survives_passing_five_digits(): void
    {
        $invoice = $this->invoice();
        $invoice->forceFill(['number' => 'INV-2026-99999'])->save();

        $this->assertSame('INV-2026-100000', $this->invoice()->number);
        $this->assertSame('INV-2026-100001', $this->invoice()->number);
    }

    // ═══════════════════════════════════════════════════════════
    //  العيب الثاني: التزامن
    // ═══════════════════════════════════════════════════════════

    /**
     * **طلبان متزامنان فعلاً** على اتصالين مستقلّين بالقاعدة.
     *
     * يولّد الأول رقمه داخل معاملةٍ لم تُغلق بعد — فيقفل مِرساة الترقيم. ثم
     * يحاول الثاني قفلَ المِرساة نفسها على اتصاله الخاص بمهلةٍ قصيرة: فإن
     * كانت مقفولة فعلاً انتظر حتى انتهت مهلته، وهو ما يُثبته هذا الاختبار.
     * ولولا القفل لمرّ الثاني فوراً وقرأ الحدَّ الأقصى نفسه فأعاد الرقم نفسه.
     *
     * **لماذا يُنشأ المستأجر على الاتصال المنافس؟** لأن `RefreshDatabase`
     * يلفّ كل اختبار في معاملة لا تُغلق، فما يُنشأ داخلها لا يراه أي اتصال
     * آخر — ولا يوجد صفٌّ ليُقفل أصلاً. فيُنشأ صفّ المِرساة خارجها ليكون
     * مرئياً للطرفين، وهو شرط أن يكون التزامن حقيقياً لا صورياً.
     *
     * يعمل على PostgreSQL وحده: SQLite يُسلسِل الكتابات بقفلٍ عام على الملف،
     * فلا `FOR UPDATE` فيه ولا تزامنَ حقيقياً يُختبر.
     *
     * @test
     */
    public function two_concurrent_requests_cannot_take_the_same_number(): void
    {
        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('التزامن الحقيقي يُختبر على PostgreSQL — SQLite يُسلسِل الكتابات بقفل ملفٍّ عام.');
        }

        config(['database.connections.rival' => config('database.connections.pgsql')]);
        $rival = DB::connection('rival');

        // مِرساة مرئية للاتصالين: تُنشأ خارج معاملة الاختبار وتُنظَّف بعده.
        $anchorId = (string) Str::uuid();
        $rival->table('tenants')->insert([
            'id'         => $anchorId,
            'name'       => 'مستأجر المِرساة',
            'slug'       => 'anchor-' . substr($anchorId, 0, 8),
            'currency'   => 'SAR',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // يُحذف في tearDown: القفل يبقى قائماً حتى تتراجع معاملة الاختبار،
        // فحذفه هنا يُحجب هو نفسه بالقفل الذي نختبره.
        $this->anchorTenantId = $anchorId;

        app(TenantContext::class)->set($anchorId);
        $rival->statement("SET lock_timeout = '750ms'");

        $blocked = false;

        try {
            DB::transaction(function () use ($rival, $anchorId, &$blocked) {
                // الطلب الأول: يقفل المِرساة ولا يُنهي معاملته بعد.
                $this->assertSame('INV-2026-00001', Invoice::nextDocumentNumber('INV', '2026-03-01'));

                // الطلب الثاني على اتصالٍ مستقلّ — يجب أن يُحجب حتى تنتهي مهلته.
                try {
                    $rival->transaction(fn () => $rival->table('tenants')
                        ->where('id', $anchorId)
                        ->lockForUpdate()
                        ->first());
                } catch (QueryException $e) {
                    $blocked = true;
                }
            });
        } finally {
            app(TenantContext::class)->set($this->tenant->id);
        }

        $this->assertTrue($blocked, 'مِرساة الترقيم لم تُقفل — التوليد المتزامن غير مُسلسَل.');
    }

    /**
     * الحاجز الأخير خلف القفل: القيد الفريد نفسه. لا يمرّ رقمٌ مكرر إلى
     * القاعدة مهما حدث في طبقة التطبيق.
     *
     * @test
     */
    public function the_unique_constraint_rejects_a_duplicate_number(): void
    {
        $first = $this->invoice();

        $this->expectException(QueryException::class);

        Invoice::create([
            'number'       => $first->number,
            'partner_id'   => $this->customer->id,
            'branch_id'    => $first->branch_id,
            'type'         => 'sale',
            'invoice_date' => '2026-03-01',
        ]);
    }

    // ═══════════════════════════════════════════════════════════
    //  استقلال سلاسل الفروع
    // ═══════════════════════════════════════════════════════════

    /**
     * لكل فرع سلسلته: الرقم نفسه يتعايش في فرعين تحت القيد الموسَّع
     * `(tenant_id, branch_id, number)`.
     *
     * @test
     */
    public function each_branch_keeps_an_independent_series(): void
    {
        $riyadh = \App\Models\Branch::create(['name' => 'الرياض', 'code' => '00001']);
        $khobar = \App\Models\Branch::create(['name' => 'الخبر', 'code' => '00002']);

        app(BranchContext::class)->set($riyadh->id);
        $this->assertSame('INV-2026-00001', $this->invoice()->number);
        $this->assertSame('INV-2026-00002', $this->invoice()->number);

        app(BranchContext::class)->set($khobar->id);
        $this->assertSame('INV-2026-00001', $this->invoice()->number);

        app(BranchContext::class)->set($riyadh->id);
        $this->assertSame('INV-2026-00003', $this->invoice()->number);

        app(BranchContext::class)->forget();

        $this->assertSame(2, Invoice::where('number', 'INV-2026-00001')->count());
    }

    /**
     * الكيانات المصنَّفة `CompanyWide` تبقى بسلسلة واحدة للمؤسسة مهما تنقّل
     * الفرع النشط — القيد المحاسبي أوّلها.
     *
     * @test
     */
    public function company_wide_entities_keep_one_series_across_branches(): void
    {
        $riyadh = \App\Models\Branch::create(['name' => 'الرياض', 'code' => '00001']);
        $khobar = \App\Models\Branch::create(['name' => 'الخبر', 'code' => '00002']);

        app(BranchContext::class)->set($riyadh->id);
        $first = JournalEntry::nextDocumentNumber('JE', '2026-03-01');

        app(BranchContext::class)->set($khobar->id);
        JournalEntry::create([
            'number'      => $first,
            'entry_date'  => '2026-03-01',
            'description' => 'قيد',
            'status'      => 'posted',
        ]);

        $this->assertSame('JE-2026-00001', $first);
        $this->assertSame('JE-2026-00002', JournalEntry::nextDocumentNumber('JE', '2026-03-01'));
    }

    /**
     * رقم الموظف: سلسلة واحدة **للمؤسسة** بلا سنة ولا فرع.
     *
     * `Employee` موسوم بالفرع (مكان العمل) لكنه مصنَّف `CompanyWide`: الوسم
     * وصفيٌّ لا نطاقُ ترقيم. ولولا ذلك لتكرّر `EMP-00001` في مسيّر الرواتب
     * الواحد — و`PayrollRun` مؤسسيٌّ يضمّ كل الموظفين بلا تمييز فرع.
     *
     * @test
     */
    public function employee_numbers_run_as_one_company_wide_series(): void
    {
        $riyadh = \App\Models\Branch::create(['name' => 'الرياض', 'code' => '00001']);
        $khobar = \App\Models\Branch::create(['name' => 'الخبر', 'code' => '00002']);

        $hire = function (string $branchId): string {
            app(BranchContext::class)->set($branchId);
            $no = Employee::nextDocumentNumber('EMP');

            Employee::create([
                'employee_no' => $no, 'name' => 'موظف', 'basic_salary' => 500000,
                'hire_date'   => '2026-01-01',
            ]);

            return $no;
        };

        // السلسلة تتّصل عبر الفروع ولا تنقسم بها.
        $this->assertSame('EMP-00001', $hire($riyadh->id));
        $this->assertSame('EMP-00002', $hire($khobar->id));
        $this->assertSame('EMP-00003', $hire($riyadh->id));

        // ومع ذلك يبقى الوسم الوصفي بمكان العمل قائماً.
        $this->assertSame($khobar->id, Employee::where('employee_no', 'EMP-00002')->value('branch_id'));

        app(BranchContext::class)->forget();
    }

    // ═══════════════════════════════════════════════════════════
    //  عدّاد ZATCA — خارج طبقة الترقيم تماماً
    // ═══════════════════════════════════════════════════════════

    /**
     * `zatca_icv` عدّاد سلسلة الإصدار للكيان القانوني الواحد: يتصل على مستوى
     * المستأجر ولا ينقسم بالفرع، بخلاف رقم الفاتورة المعروض تماماً.
     *
     * @test
     */
    public function the_zatca_counter_stays_tenant_wide_while_numbers_split_by_branch(): void
    {
        $riyadh = \App\Models\Branch::create(['name' => 'الرياض', 'code' => '00001']);
        $khobar = \App\Models\Branch::create(['name' => 'الخبر', 'code' => '00002']);

        app(BranchContext::class)->set($riyadh->id);
        $first = app(InvoiceService::class)->post($this->invoice());

        app(BranchContext::class)->set($khobar->id);
        $second = app(InvoiceService::class)->post($this->invoice());

        // رقم العرض: انقسم بالفرع فبدأ كلاهما من ١.
        $this->assertSame('INV-2026-00001', $first->number);
        $this->assertSame('INV-2026-00001', $second->number);

        // عدّاد ZATCA: سلسلة واحدة متصلة للمستأجر، وسلسلة الهاش تتبعها.
        $this->assertSame(1, $first->zatca_icv);
        $this->assertSame(2, $second->zatca_icv);
        $this->assertSame($first->zatca_hash, $second->zatca_previous_hash);
    }

    /** القيد الفريد على العدّاد يمنع كسر السلسلة صامتاً. @test */
    public function the_zatca_counter_cannot_be_duplicated(): void
    {
        $posted = app(InvoiceService::class)->post($this->invoice());
        $other  = $this->invoice();

        $this->expectException(QueryException::class);

        $other->forceFill(['zatca_icv' => $posted->zatca_icv])->save();
    }
}
