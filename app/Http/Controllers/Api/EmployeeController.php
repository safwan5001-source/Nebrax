<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreContractRequest;
use App\Http\Requests\StoreEmployeeAttachmentsRequest;
use App\Http\Requests\StoreEmployeeRequest;
use App\Http\Requests\StoreEmployeeRequestRequest;
use App\Http\Requests\StoreLeaveRequestRequest;
use App\Http\Requests\UpdateContractRequest;
use App\Http\Requests\UpdateEmployeeRequest;
use App\Http\Requests\UploadEmployeePhotoRequest;
use App\Http\Resources\ContractResource;
use App\Http\Resources\EmployeeAttachmentResource;
use App\Http\Resources\EmployeeRequestResource;
use App\Http\Resources\EmployeeResource;
use App\Http\Resources\LeaveRequestResource;
use App\Models\Branch;
use App\Models\Contract;
use App\Models\Department;
use App\Models\Employee;
use App\Models\EmploymentType;
use App\Models\JobLevel;
use App\Models\JobTitle;
use App\Models\LeaveRequest;
use App\Models\LeaveType;
use App\Models\RequestType;
use App\Models\Shift;
use App\Services\AttachmentStorage;
use App\Tenancy\BranchScope;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\StreamedResponse;

class EmployeeController extends ApiController
{
    private const WITH = ['manager', 'jobTitle', 'department', 'jobLevel', 'employmentType'];

    public function __construct(protected AttachmentStorage $attachmentStorage) {}

    public function index(): JsonResponse
    {
        return EmployeeResource::collection(Employee::with(self::WITH)->latest()->get())->response();
    }

    public function store(StoreEmployeeRequest $request): JsonResponse
    {
        $data = $request->validated();
        $this->assertTenantOwned(Branch::class, $data['branch_id'] ?? null, 'الفرع');
        $this->assertTenantOwned(Employee::class, $data['manager_id'] ?? null, 'المدير المباشر');
        $this->assertOwnedShift($data['shift_id'] ?? null);
        $this->assertOrgStructureOwned($data);
        // الترقيم داخل معاملة: قفل المِرساة في طبقة الترقيم لا يُسلسِل شيئاً بدونها.
        $employee = DB::transaction(function () use ($data) {
            $data['employee_no'] ??= Employee::nextDocumentNumber('EMP');

            return Employee::create($data);
        });

        return (new EmployeeResource($employee->load(self::WITH)))->response()->setStatusCode(201);
    }

    public function show(string $id): JsonResponse
    {
        return (new EmployeeResource(Employee::with(self::WITH)->findOrFail($id)))->response();
    }

    public function update(UpdateEmployeeRequest $request, string $id): JsonResponse
    {
        $employee = Employee::findOrFail($id);
        $data = $request->validated();

        if (($data['manager_id'] ?? null) === $id) {
            abort(422, 'لا يمكن أن يكون الموظف مديره المباشر.');
        }

        $this->assertTenantOwned(Branch::class, $data['branch_id'] ?? null, 'الفرع');
        $this->assertTenantOwned(Employee::class, $data['manager_id'] ?? null, 'المدير المباشر');
        $this->assertOwnedShift($data['shift_id'] ?? null);
        $this->assertOrgStructureOwned($data);
        $employee->update($data);

        return (new EmployeeResource($employee->load(self::WITH)))->response();
    }

    /** الهيكل التنظيمي كيانات مُدارة CompanyWide — لا حاجة لتحقّق مرجعي عابر للفرع كالوردية. */
    private function assertOrgStructureOwned(array $data): void
    {
        $this->assertTenantOwned(JobTitle::class, $data['job_title_id'] ?? null, 'المسمى الوظيفي');
        $this->assertTenantOwned(Department::class, $data['department_id'] ?? null, 'القسم');
        $this->assertTenantOwned(JobLevel::class, $data['job_level_id'] ?? null, 'المستوى الوظيفي');
        $this->assertTenantOwned(EmploymentType::class, $data['employment_type_id'] ?? null, 'نوع التوظيف');
    }

    /**
     * `Shift` مصنَّفٌ `BranchScoped`، فـ`assertTenantOwned` العادي يُصفّى
     * بالفرع النشط ويُخطئ رفض ورديةٍ صحيحة تخصّ فرعاً آخر. الموظف `CompanyWide`
     * يجوز ربطه بوردية أيّ فرع، فالتحقّق هنا **مرجعٌ** يتجاوز عزل الفرع عمداً
     * (نمط `BranchScope::reference`) ويبقي عزل المستأجر وحده.
     */
    private function assertOwnedShift(?string $shiftId): void
    {
        if ($shiftId !== null && ! BranchScope::reference(Shift::class)->whereKey($shiftId)->exists()) {
            abort(422, 'الوردية غير موجودة.');
        }
    }

    public function destroy(string $id): JsonResponse
    {
        $employee = Employee::findOrFail($id);
        $attachments = $employee->attachments()->get();

        // بياناتٌ شخصية: لا يُترك كائنٌ يتيمٌ لا يجده سردٌ ولا إعادة محاولة (Plan §9.2)، ولا يُمحى ملفٌ
        // لموظفٍ بقي. لذلك حذف الصفوف ثم محو الكائنات **داخل معاملة واحدة والمحو قبل الـcommit**:
        // فشل الحذف (قيد مرجعي) لا يمحو شيئاً، وفشل المحو يُرجع الصفوف فيُعاد الطلب
        // (محو كائنٍ مفقود لا يُعدّ خطأً).
        DB::transaction(function () use ($employee, $attachments): void {
            $photo = $employee->photo_path
                ? ['disk' => $this->photoDisk($employee), 'path' => $employee->photo_path]
                : null;
            $employee->delete();

            if ($photo !== null) {
                $this->attachmentStorage->delete($photo['disk'], $photo['path']);
            }
            foreach ($attachments as $attachment) {
                $this->attachmentStorage->delete($attachment->disk, $attachment->path);
            }
        });

        return response()->json(['message' => 'تم الحذف.']);
    }

    /** مخزن صورة الموظف من العمود الصريح: `null`/`local` = القرص المحلي القديم (Q13). */
    private function photoDisk(Employee $employee): string
    {
        return $employee->photo_disk ?: 'local';
    }

    /**
     * يستبدل صورة الموظف — لا يمرّ عبر update العادي عمداً. الترتيب (يعالج B3): الجديدة تُكتب أولاً،
     * ثم يُثبَّت المؤشّر، ثم تُحذف القديمة؛ فشل حفظ الجديدة لا يُضيع القديمة.
     */
    public function uploadPhoto(UploadEmployeePhotoRequest $request, string $id): JsonResponse
    {
        $employee = Employee::findOrFail($id);
        $old = $employee->photo_path ? ['disk' => $this->photoDisk($employee), 'path' => $employee->photo_path] : null;

        $new = $this->attachmentStorage->put(
            AttachmentStorage::DOMAIN_EMPLOYEE_PHOTO, (string) $employee->id, $request->file('photo'), "employees/{$employee->id}",
        );

        try {
            $employee->photo_path = $new['path'];
            $employee->photo_disk = $new['disk'];
            $employee->save();
        } catch (\Throwable $e) {
            $this->attachmentStorage->discard([$new]);
            throw $e;
        }

        if ($old !== null) {
            // الجديدة ثُبّتت؛ فشل محو القديمة يُسجَّل بمفتاح الكائن للتنظيف اليدوي ولا يُفشل الطلب.
            $this->attachmentStorage->discard([$old]);
        }

        return (new EmployeeResource($employee->load(self::WITH)))->response();
    }

    public function removePhoto(string $id): JsonResponse
    {
        $employee = Employee::findOrFail($id);

        if ($employee->photo_path) {
            // محو الكائن قبل إزالة المؤشّر (بيانات شخصية) — الفشل يرمي والمؤشّر باقٍ فيُعاد المحاولة.
            $this->attachmentStorage->delete($this->photoDisk($employee), $employee->photo_path);
            $employee->photo_path = null;
            $employee->photo_disk = null;
            $employee->save();
        }

        return (new EmployeeResource($employee->load(self::WITH)))->response();
    }

    /** بث الصورة للعرض المباشر (لا تنزيل قسري) — يمرّ بعزل المستأجر عبر findOrFail العادي. */
    public function showPhoto(string $id): StreamedResponse
    {
        $employee = Employee::findOrFail($id);

        if (! $employee->photo_path) {
            abort(404, 'لا صورة لهذا الموظف.');
        }

        return $this->attachmentStorage->inlineImage($this->photoDisk($employee), $employee->photo_path);
    }

    /** مسوّغات التعيين لهذا الموظف. */
    public function indexAttachments(string $id): JsonResponse
    {
        $employee = Employee::findOrFail($id);

        return EmployeeAttachmentResource::collection($employee->attachments()->latest()->get())->response();
    }

    /**
     * تُحفَظ الملفات على قرص خاص وتُربط بالموظف. لا يُقبل من العميل مسار
     * جاهز، فلا يستطيع ربط مستند بملف يخصّ مستأجراً أو موظفاً آخر.
     */
    public function storeAttachments(StoreEmployeeAttachmentsRequest $request, string $id): JsonResponse
    {
        $employee = Employee::findOrFail($id);

        // كلُّها أو لا شيء: فشل ملف لا يُبقي صفاً ولا كائناً.
        $stored = $this->attachmentStorage->putMany(
            AttachmentStorage::DOMAIN_EMPLOYEE, (string) $employee->id, $request->file('attachments', []),
            "employees/{$employee->id}/attachments",
        );

        try {
            DB::transaction(function () use ($employee, $stored, $request): void {
                foreach ($stored as $file) {
                    $employee->attachments()->create($file + ['uploaded_by' => $request->user()?->id]);
                }
            });
        } catch (\Throwable $e) {
            $this->attachmentStorage->discard($stored);
            throw $e;
        }

        return EmployeeAttachmentResource::collection($employee->attachments()->latest()->get())
            ->response()->setStatusCode(201);
    }

    /** تنزيل مرفقٍ خاص بعد إثبات أنه يعود لهذا الموظف. */
    public function downloadAttachment(string $id, string $attachmentId): StreamedResponse
    {
        $employee = Employee::findOrFail($id);
        $attachment = $employee->attachments()->whereKey($attachmentId)->firstOrFail();

        return $this->attachmentStorage->download(
            $attachment->disk, $attachment->path, $attachment->original_name, $attachment->mime_type,
        );
    }

    public function destroyAttachment(string $id, string $attachmentId): JsonResponse
    {
        $employee = Employee::findOrFail($id);
        $attachment = $employee->attachments()->whereKey($attachmentId)->firstOrFail();
        // بيانات شخصية: محو الكائن قبل الصف؛ الفشل يرمي والصف باقٍ فيُعاد المحاولة.
        $this->attachmentStorage->delete($attachment->disk, $attachment->path);
        $attachment->delete();

        return response()->json(['message' => 'تم الحذف.']);
    }

    /** عقود هذا الموظف عبر الزمن، الأحدث بدءاً أولاً. */
    public function indexContracts(string $id): JsonResponse
    {
        $employee = Employee::findOrFail($id);

        return ContractResource::collection($employee->contracts()->with('items')->orderByDesc('start_date')->get())->response();
    }

    public function storeContracts(StoreContractRequest $request, string $id): JsonResponse
    {
        $employee = Employee::findOrFail($id);
        $data = $request->validated();
        $items = $data['items'];
        unset($data['items']);
        $this->assertNoContractOverlap($employee->id, $data);

        $contract = $this->domain(function () use ($employee, $data, $items, $request) {
            $contract = $employee->contracts()->create(array_merge($data, [
                'created_by' => $request->user()?->id,
            ]));
            $this->replaceContractItems($contract, $items);

            return $contract;
        });

        return (new ContractResource($contract->load('items')))->response()->setStatusCode(201);
    }

    public function updateContract(UpdateContractRequest $request, string $id, string $contractId): JsonResponse
    {
        $employee = Employee::findOrFail($id);
        $contract = $employee->contracts()->whereKey($contractId)->firstOrFail();
        $data = $request->validated();
        $items = $data['items'] ?? null;
        unset($data['items']);

        $mergedStart = $data['start_date'] ?? $contract->start_date->toDateString();
        $mergedEnd = array_key_exists('end_date', $data) ? $data['end_date'] : optional($contract->end_date)->toDateString();
        if ($mergedEnd !== null && $mergedEnd < $mergedStart) {
            abort(422, 'تاريخ نهاية العقد يجب أن يكون بعد تاريخ بدايته أو يساويه.');
        }

        $this->assertNoContractOverlap($employee->id, array_merge($data, [
            'status'     => $data['status'] ?? $contract->status,
            'start_date' => $mergedStart,
            'end_date'   => $mergedEnd,
        ]), $contract->id);

        $this->domain(function () use ($contract, $data, $items) {
            $contract->update($data);
            if ($items !== null) {
                $this->replaceContractItems($contract, $items);
            }
        });

        return (new ContractResource($contract->load('items')))->response();
    }

    /** يستبدل بنود العقد كاملةً — لا تعديل بندٍ واحدٍ جزئياً (نطاق البناء الأول). */
    private function replaceContractItems(Contract $contract, array $items): void
    {
        $contract->items()->delete();
        $contract->items()->createMany(array_map(fn (array $item, int $i) => [
            'tenant_id'  => $contract->tenant_id,
            'category'   => $item['category'],
            'name'       => $item['name'],
            'amount'     => $item['amount'],
            'sort_order' => $i,
        ], $items, array_keys($items)));
    }

    public function destroyContract(string $id, string $contractId): JsonResponse
    {
        $employee = Employee::findOrFail($id);
        $employee->contracts()->whereKey($contractId)->firstOrFail()->delete();

        return response()->json(['message' => 'تم الحذف.']);
    }

    /** إجازات هذا الموظف عبر الزمن، الأحدث بدءاً أولاً. */
    public function indexLeaveRequests(string $id): JsonResponse
    {
        $employee = Employee::findOrFail($id);

        return LeaveRequestResource::collection(
            $employee->leaveRequests()->with(['leaveType', 'approver'])->orderByDesc('start_date')->get()
        )->response();
    }

    /**
     * إنشاء طلب إجازة؛ يبدأ `pending` إن احتاج نوعه موافقة، أو `approved`
     * تلقائياً فوراً إن لم يحتَج (`leaveType.requires_approval`).
     */
    public function storeLeaveRequests(StoreLeaveRequestRequest $request, string $id): JsonResponse
    {
        $employee = Employee::findOrFail($id);
        $data = $request->validated();

        $leaveType = LeaveType::whereKey($data['leave_type_id'])->where('is_active', true)->first();
        if (! $leaveType) {
            abort(422, 'نوع الإجازة غير موجود.');
        }

        $this->assertNoLeaveOverlap($employee->id, $data['start_date'], $data['end_date']);

        $daysCount = Carbon::parse($data['start_date'])->diffInDays(Carbon::parse($data['end_date'])) + 1;
        $autoApproved = ! $leaveType->requires_approval;

        $leaveRequest = $employee->leaveRequests()->create([
            'leave_type_id' => $leaveType->id,
            'start_date'    => $data['start_date'],
            'end_date'      => $data['end_date'],
            'days_count'    => $daysCount,
            'status'        => $autoApproved ? 'approved' : 'pending',
            'reason'        => $data['reason'] ?? null,
            'approved_by'   => $autoApproved ? $request->user()?->id : null,
            'approved_at'   => $autoApproved ? now() : null,
            'created_by'    => $request->user()?->id,
        ]);

        return (new LeaveRequestResource($leaveRequest->load(['leaveType', 'approver'])))->response()->setStatusCode(201);
    }

    /** رصيد كل نوع إجازةٍ نشطٍ لهذا الموظف عن السنة الحالية — مباشرٌ لا مُخزَّن. */
    public function leaveBalances(string $id): JsonResponse
    {
        $employee = Employee::findOrFail($id);
        $leaveTypes = LeaveType::where('is_active', true)->orderBy('name')->get();

        return response()->json([
            'data' => $leaveTypes->map(fn (LeaveType $type) => array_merge([
                'leave_type_id'   => $type->id,
                'leave_type_name' => $type->name,
                'is_paid'         => $type->is_paid,
            ], $type->balanceFor($employee->id)))->values(),
        ]);
    }

    /** طلبات هذا الموظف العامة (سلفة/استئذان/شكوى...) عبر الزمن، الأحدث أولاً. */
    public function indexRequests(string $id): JsonResponse
    {
        $employee = Employee::findOrFail($id);

        return EmployeeRequestResource::collection(
            $employee->employeeRequests()->with(['requestType', 'approver'])->latest()->get()
        )->response();
    }

    /**
     * إنشاء طلبٍ عام؛ يبدأ `pending` إن احتاج نوعه موافقة، أو `approved`
     * تلقائياً فوراً إن لم يحتَج (`requestType.requires_approval`).
     */
    public function storeRequests(StoreEmployeeRequestRequest $request, string $id): JsonResponse
    {
        $employee = Employee::findOrFail($id);
        $data = $request->validated();

        $requestType = RequestType::whereKey($data['request_type_id'])->where('is_active', true)->first();
        if (! $requestType) {
            abort(422, 'نوع الطلب غير موجود.');
        }

        $autoApproved = ! $requestType->requires_approval;

        $employeeRequest = $employee->employeeRequests()->create([
            'request_type_id' => $requestType->id,
            'title'           => $data['title'],
            'description'     => $data['description'] ?? null,
            'requested_date'  => $data['requested_date'] ?? null,
            'status'          => $autoApproved ? 'approved' : 'pending',
            'approved_by'     => $autoApproved ? $request->user()?->id : null,
            'approved_at'     => $autoApproved ? now() : null,
            'created_by'      => $request->user()?->id,
        ]);

        return (new EmployeeRequestResource($employeeRequest->load(['requestType', 'approver'])))->response()->setStatusCode(201);
    }

    /**
     * يمنع تقاطع عقدٍ جديد أو مُعدَّل مع عقدٍ آخر بحالة `active` لنفس الموظف:
     * عقدان نشطان يتداخلان زمنياً يجعلان «العقد النشط» غامضاً وقت مسيّر
     * الرواتب. عقدٌ بحالة `ended`/`terminated` تاريخي لا يشارك في هذا الفحص.
     */
    private function assertNoContractOverlap(string $employeeId, array $data, ?string $exceptId = null): void
    {
        if (($data['status'] ?? 'active') !== 'active') {
            return;
        }

        $start = $data['start_date'];
        $end = $data['end_date'] ?? null;

        // whereDate() لا where() — انظر التعليق المطابق في Contract::activeFor().
        $query = Contract::where('employee_id', $employeeId)
            ->where('status', 'active')
            ->whereDate('start_date', '<=', $end ?? '9999-12-31')
            ->where(function ($q) use ($start) {
                $q->whereNull('end_date')->orWhereDate('end_date', '>=', $start);
            });

        if ($exceptId !== null) {
            $query->whereKeyNot($exceptId);
        }

        if ($query->exists()) {
            abort(422, 'يوجد عقدٌ آخر نشط لهذا الموظف يتقاطع مع هذه الفترة.');
        }
    }

    /**
     * يمنع تقاطع طلب إجازةٍ جديد مع طلبٍ آخر `pending`/`approved` لنفس
     * الموظف زمنياً. طلبٌ `rejected`/`cancelled` تاريخي لا يشارك في هذا الفحص.
     */
    private function assertNoLeaveOverlap(string $employeeId, string $start, string $end): void
    {
        $overlap = LeaveRequest::where('employee_id', $employeeId)
            ->whereIn('status', ['pending', 'approved'])
            ->whereDate('start_date', '<=', $end)
            ->whereDate('end_date', '>=', $start)
            ->exists();

        if ($overlap) {
            abort(422, 'يوجد طلب إجازةٍ آخر لهذا الموظف يتقاطع مع هذه الفترة.');
        }
    }
}
