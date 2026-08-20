<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreContractRequest;
use App\Http\Requests\StoreEmployeeAttachmentsRequest;
use App\Http\Requests\StoreEmployeeRequest;
use App\Http\Requests\UpdateContractRequest;
use App\Http\Requests\UpdateEmployeeRequest;
use App\Http\Requests\UploadEmployeePhotoRequest;
use App\Http\Resources\ContractResource;
use App\Http\Resources\EmployeeAttachmentResource;
use App\Http\Resources\EmployeeResource;
use App\Models\Branch;
use App\Models\Contract;
use App\Models\Department;
use App\Models\Employee;
use App\Models\EmploymentType;
use App\Models\JobLevel;
use App\Models\JobTitle;
use App\Models\Shift;
use App\Tenancy\BranchScope;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

class EmployeeController extends ApiController
{
    private const WITH = ['manager', 'jobTitle', 'department', 'jobLevel', 'employmentType'];

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
        if ($employee->photo_path) {
            Storage::disk('local')->delete($employee->photo_path);
        }
        $attachments = $employee->attachments()->get();
        $employee->delete();
        foreach ($attachments as $attachment) {
            Storage::disk($attachment->disk)->delete($attachment->path);
        }

        return response()->json(['message' => 'تم الحذف.']);
    }

    /** يستبدل صورة الموظف (إن وُجدت سابقاً تُحذف) — لا يمرّ عبر update العادي عمداً. */
    public function uploadPhoto(UploadEmployeePhotoRequest $request, string $id): JsonResponse
    {
        $employee = Employee::findOrFail($id);

        if ($employee->photo_path) {
            Storage::disk('local')->delete($employee->photo_path);
        }

        $employee->photo_path = $request->file('photo')->store("employees/{$employee->id}", 'local');
        $employee->save();

        return (new EmployeeResource($employee->load(self::WITH)))->response();
    }

    public function removePhoto(string $id): JsonResponse
    {
        $employee = Employee::findOrFail($id);

        if ($employee->photo_path) {
            Storage::disk('local')->delete($employee->photo_path);
            $employee->photo_path = null;
            $employee->save();
        }

        return (new EmployeeResource($employee->load(self::WITH)))->response();
    }

    /** بث الصورة للعرض المباشر (لا تنزيل قسري) — يمرّ بعزل المستأجر عبر findOrFail العادي. */
    public function showPhoto(string $id): StreamedResponse
    {
        $employee = Employee::findOrFail($id);
        $disk = Storage::disk('local');

        if (! $employee->photo_path || ! $disk->exists($employee->photo_path)) {
            abort(404, 'لا صورة لهذا الموظف.');
        }

        return $disk->response($employee->photo_path);
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

        foreach ($request->file('attachments', []) as $file) {
            $path = $file->store("employees/{$employee->id}/attachments", 'local');

            $employee->attachments()->create([
                'disk'          => 'local',
                'path'          => $path,
                'original_name' => $file->getClientOriginalName(),
                'mime_type'     => $file->getMimeType(),
                'size'          => $file->getSize(),
                'uploaded_by'   => $request->user()?->id,
            ]);
        }

        return EmployeeAttachmentResource::collection($employee->attachments()->latest()->get())
            ->response()->setStatusCode(201);
    }

    /** تنزيل مرفقٍ خاص بعد إثبات أنه يعود لهذا الموظف. */
    public function downloadAttachment(string $id, string $attachmentId): StreamedResponse
    {
        $employee = Employee::findOrFail($id);
        $attachment = $employee->attachments()->whereKey($attachmentId)->firstOrFail();
        $disk = Storage::disk($attachment->disk);

        if (! $disk->exists($attachment->path)) {
            abort(404, 'ملف المرفق غير موجود.');
        }

        return $disk->download($attachment->path, $attachment->original_name, [
            'Content-Type' => $attachment->mime_type ?? 'application/octet-stream',
        ]);
    }

    public function destroyAttachment(string $id, string $attachmentId): JsonResponse
    {
        $employee = Employee::findOrFail($id);
        $attachment = $employee->attachments()->whereKey($attachmentId)->firstOrFail();
        $disk = $attachment->disk;
        $path = $attachment->path;
        $attachment->delete();
        Storage::disk($disk)->delete($path);

        return response()->json(['message' => 'تم الحذف.']);
    }

    /** عقود هذا الموظف عبر الزمن، الأحدث بدءاً أولاً. */
    public function indexContracts(string $id): JsonResponse
    {
        $employee = Employee::findOrFail($id);

        return ContractResource::collection($employee->contracts()->orderByDesc('start_date')->get())->response();
    }

    public function storeContracts(StoreContractRequest $request, string $id): JsonResponse
    {
        $employee = Employee::findOrFail($id);
        $data = $request->validated();
        $this->assertNoContractOverlap($employee->id, $data);

        $contract = $employee->contracts()->create(array_merge($data, [
            'created_by' => $request->user()?->id,
        ]));

        return (new ContractResource($contract))->response()->setStatusCode(201);
    }

    public function updateContract(UpdateContractRequest $request, string $id, string $contractId): JsonResponse
    {
        $employee = Employee::findOrFail($id);
        $contract = $employee->contracts()->whereKey($contractId)->firstOrFail();
        $data = $request->validated();

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

        $contract->update($data);

        return (new ContractResource($contract))->response();
    }

    public function destroyContract(string $id, string $contractId): JsonResponse
    {
        $employee = Employee::findOrFail($id);
        $employee->contracts()->whereKey($contractId)->firstOrFail()->delete();

        return response()->json(['message' => 'تم الحذف.']);
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
}
