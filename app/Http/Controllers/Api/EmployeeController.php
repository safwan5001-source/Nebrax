<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreEmployeeAttachmentsRequest;
use App\Http\Requests\StoreEmployeeRequest;
use App\Http\Requests\UpdateEmployeeRequest;
use App\Http\Requests\UploadEmployeePhotoRequest;
use App\Http\Resources\EmployeeAttachmentResource;
use App\Http\Resources\EmployeeResource;
use App\Models\Branch;
use App\Models\Employee;
use App\Models\Shift;
use App\Tenancy\BranchScope;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

class EmployeeController extends ApiController
{
    public function index(): JsonResponse
    {
        return EmployeeResource::collection(Employee::with('manager')->latest()->get())->response();
    }

    public function store(StoreEmployeeRequest $request): JsonResponse
    {
        $data = $request->validated();
        $this->assertTenantOwned(Branch::class, $data['branch_id'] ?? null, 'الفرع');
        $this->assertTenantOwned(Employee::class, $data['manager_id'] ?? null, 'المدير المباشر');
        $this->assertOwnedShift($data['shift_id'] ?? null);
        // الترقيم داخل معاملة: قفل المِرساة في طبقة الترقيم لا يُسلسِل شيئاً بدونها.
        $employee = DB::transaction(function () use ($data) {
            $data['employee_no'] ??= Employee::nextDocumentNumber('EMP');

            return Employee::create($data);
        });

        return (new EmployeeResource($employee->load('manager')))->response()->setStatusCode(201);
    }

    public function show(string $id): JsonResponse
    {
        return (new EmployeeResource(Employee::with('manager')->findOrFail($id)))->response();
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
        $employee->update($data);

        return (new EmployeeResource($employee->load('manager')))->response();
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

        return (new EmployeeResource($employee->load('manager')))->response();
    }

    public function removePhoto(string $id): JsonResponse
    {
        $employee = Employee::findOrFail($id);

        if ($employee->photo_path) {
            Storage::disk('local')->delete($employee->photo_path);
            $employee->photo_path = null;
            $employee->save();
        }

        return (new EmployeeResource($employee->load('manager')))->response();
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
}
