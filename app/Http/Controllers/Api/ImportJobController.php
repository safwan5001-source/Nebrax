<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\ApplyImportJobRequest;
use App\Http\Requests\StoreImportJobRequest;
use App\Http\Requests\StoreImportRepairRequest;
use App\Http\Resources\ImportJobResource;
use App\Models\ImportJob;
use App\Services\ImportJobAccess;
use App\Services\ImportJobFailuresExporter;
use App\Services\ImportJobService;
use App\Services\ImportRepairService;
use App\Support\SensitiveCostPolicy;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * PR-DUR-1 — بنية تشغيلة الاستيراد الدائم فقط: رفع/فحص هيكلي/عرض/إلغاء.
 * لا علاقة له بأي مسار استيراد حالي (`/products/import/*`، `/products/workbook/*`،
 * `/inventory-openings/import/*`) — مسارٌ إضافي مستقل تماماً، صفر تأثير عليها.
 */
class ImportJobController extends ApiController
{
    public function __construct(
        private readonly ImportJobService $jobs,
        private readonly ImportJobAccess $access,
        private readonly ImportJobFailuresExporter $failures,
        private readonly ImportRepairService $repairs,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'domain' => ['sometimes', 'nullable', 'string'],
            'status' => ['sometimes', 'nullable', 'string'],
            'per_page' => ['sometimes', 'nullable', 'integer', 'min:10', 'max:100'],
        ]);

        // IMP-H1-S1: القائمة تُصفّى إلى المجالات التي يملك المستخدم عرضها (صلاحية + قدرة) — بلا 403، وبلا تسريب
        // لتشغيلات مجالٍ لا يراه. كانت القائمة تُظهر كل المجالات لكل من يملك `products.view`.
        $query = ImportJob::query()->whereIn('domain', $this->access->viewableDomains($request))->orderByDesc('created_at');
        if (! empty($filters['domain'])) {
            $query->where('domain', $filters['domain']);
        }
        if (! empty($filters['status'])) {
            $query->where('status', $filters['status']);
        }

        return ImportJobResource::collection(
            $query->paginate((int) ($filters['per_page'] ?? 20))->withQueryString()
        )->response();
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $this->access->assertViewAny($request);
        $job = ImportJob::query()->whereKey($id)->withCount(['units as failed_units_count' => fn ($q) => $q->where('status', 'failed')])->firstOrFail();
        $this->access->assertView($request, $job->domain);

        return (new ImportJobResource($job))->response();
    }

    /**
     * IMP-H1-S8a — الصفوف الفاشلة بقيمها الأصلية + معرّف المصدر الثابت ورمز الخطأ. **صلاحية الإدارة** (لا العرض) + قدرة المجال + نطاق فرع
     * التشغيلة: الملف يحمل بيانات الصفوف الخام. الأعمدة الحسّاسة تُحجب لمن لا يملك صلاحية الحقل (انظر `ImportJobFailuresExporter`).
     */
    public function failures(Request $request, string $id)
    {
        $this->access->assertManageAny($request);
        $job = ImportJob::query()->whereKey($id)->firstOrFail();
        $this->access->assertManage($request, $job->domain);
        $this->access->assertJobBranch($request, $job->branch_id);

        $requested = (string) ($request->validate(['format' => ['sometimes', 'nullable', 'in:csv,xlsx']])['format'] ?? '');
        // XLSX افتراضياً: ملف الإصلاح يُعاد رفعه، وCSV يسبق قيمَ `= + - @` بعلامة اقتباس (حماية من حقن الصيغ) فتتشوّه عند إعادة الرفع.
        $format = $requested !== '' ? $requested : 'xlsx';

        $file = $this->domain(fn () => $this->failures->export($job, SensitiveCostPolicy::authorized($request->user()), $format));

        return response()->download($file['path'], $file['filename'], ['Content-Type' => $file['mime']])->deleteFileAfterSend(true);
    }

    /**
     * IMP-H1-S8b — تشغيلة إصلاح **فرعية** من ملفٍّ مصحَّح (معرّف المصدر `_awj_unit_ref` لكل صف). صلاحية إدارة مجال الأم + قدرته + نطاق فرعها؛
     * العضوية تُتحقَّق قبل الإنشاء، والمطالبة الذرّية وحدةً وحدة عند الترحيل.
     */
    public function repair(StoreImportRepairRequest $request, string $id): JsonResponse
    {
        $parent = $request->parent();
        $this->access->assertManage($request, $parent->domain);
        $this->access->assertJobBranch($request, $parent->branch_id);

        $job = $this->domain(fn () => $this->repairs->start(
            $parent,
            $request->file('file'),
            $request->input('idempotency_key'),
            $request->user()?->id,
            $request->creationOptions(),
            $request->input('preview_id'),
            $request->input('preview_hash'),
        ));

        return (new ImportJobResource($job))->response()->setStatusCode($job->wasRecentlyCreated ? 201 : 200);
    }

    public function store(StoreImportJobRequest $request): JsonResponse
    {
        $job = $this->domain(fn () => $this->jobs->create(
            $request->file('file'),
            (string) $request->input('domain'),
            $request->input('idempotency_key'),
            $request->user()?->id,
            $request->file('media_archive'),
            $request->creationOptions(),
            $request->input('preview_id'),
            $request->input('preview_hash'),
        ));

        // `wasRecentlyCreated` هي علامة Eloquent الجاهزة (تُضبط `true` وحصراً
        // داخل `performInsert()`، وتبقى كذلك عبر أي `update()` لاحق على نفس
        // الكائن) — تميّز فعلياً بين إنشاءٍ جديد وإرجاع تشغيلة قائمة عبر
        // idempotency، بلا استعلامٍ إضافي وبلا تخمين من الطوابع الزمنية.
        $status = $job->wasRecentlyCreated ? 201 : 200;

        return (new ImportJobResource($job))->response()->setStatusCode($status);
    }

    /**
     * PR-DUR-2 — يرحّل قطعة واحدة محدودة الحجم. عميل الاستدعاء (worker أو
     * زر واجهة) يكرّر النداء حتى `completed`/`failed`. لا ملف في هذا الطلب —
     * التشغيلة تُقرأ من تخزينها الدائم. صلاحية التكلفة تُفحص حيّة في كل قطعة
     * (`SensitiveCostPolicy::authorized`) كما في `/products/import/apply`
     * تماماً — لا تُخزَّن ولا تُفترَض من أول استدعاء.
     */
    public function apply(ApplyImportJobRequest $request, string $id): JsonResponse
    {
        // الأرضية في `ApplyImportJobRequest::authorize`؛ هنا بوابة **مجال** التشغيلة بعد البحث عنها.
        $job = ImportJob::query()->whereKey($id)->firstOrFail();
        $this->access->assertManage($request, $job->domain);
        $this->access->assertJobBranch($request, $job->branch_id);
        $job = $this->domain(fn () => $this->jobs->applyNextChunk(
            $job,
            $request->applyOptions(),
            $request->user()?->id,
            SensitiveCostPolicy::authorized($request->user()),
            $request->explicitOptions(),
        ));

        return (new ImportJobResource($job))->response();
    }

    public function cancel(Request $request, string $id): JsonResponse
    {
        $this->access->assertManageAny($request);
        $job = ImportJob::query()->whereKey($id)->firstOrFail();
        $this->access->assertManage($request, $job->domain);
        $this->access->assertJobBranch($request, $job->branch_id);
        $job = $this->domain(fn () => $this->jobs->cancel($job, $request->user()?->id));

        return (new ImportJobResource($job))->response();
    }
}
