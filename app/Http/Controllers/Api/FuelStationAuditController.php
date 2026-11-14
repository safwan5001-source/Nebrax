<?php

namespace App\Http\Controllers\Api;

use App\Http\Resources\FuelStationAuditEventResource;
use App\Models\FuelStationAuditEvent;
use App\Models\FuelOpeningBalance;
use App\Models\FuelTanker;
use App\Models\FuelTankerFill;
use App\Models\FuelTankerOwner;
use App\Models\FuelTankerOwnerCompanyLink;
use App\Services\FuelOpeningBalanceService;
use App\Support\Rbac;
use Carbon\Carbon;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * FS-22: قراءة سجل التدقيق بالفاعل للبيانات الرئيسية والأجهزة. قراءة فقط؛ مقيَّدة بمحطات المستخدم المتاحة (فرع/مخزن)،
 * والأحداث غير المنسوبة لمحطة (منتج وقود) تظهر لغير المقيَّد فقط.
 */
class FuelStationAuditController extends ApiController
{
    /**
     * TANKER-PR1: موضوعات أصحاب الصهاريج. لقطاتها تحوي بيانات حسّاسة (اسم، هاتف، ملاحظات) محكومة بصلاحية `fuel.tanker.manage` وبوابة النشر، ولا يكفي
     * لقراءتها المفتاح القديم `fuel_stations.manage` المطلوب لهذا المسار — وإلا صار سجل التدقيق المشترك باباً خلفياً يتجاوز مفاتيح الميزة وبوابتها.
     *
     * @var list<class-string>
     */
    private const TANKER_SUBJECTS = [FuelTankerOwner::class, FuelTanker::class, FuelTankerOwnerCompanyLink::class];

    /**
     * قائمة سماح (لا قائمة منع) لأحداث `FuelTankerFill` التي يراها حامل `fuel.tanker.fill.view` وحده: حدثا السند الأساسيان. **كل ما عداها** — أحداث المرفقات
     * (`attachment_added|replaced|removed` وما قد يُضاف مستقبلاً) وأي نوع حدث جديد غير مصنَّف — يتطلب صلاحية السجل التاريخي `fuel.tanker.fill.attachment.remove`:
     * لقطاتها تحمل اسم الملف الأصلي وبصمته وتبقى بعد إزالة المرفق أو استبداله، بينما لا تعرض واجهة المرفقات العادية هذا التاريخ إلا بتلك الصلاحية.
     * إضافة نوع حدث جديد إلى هذه القائمة قرارٌ صريح بأن لقطته لا تكشف شيئاً يتجاوز عرض السند.
     *
     * @var list<string>
     */
    private const FILL_VIEW_ACTIONS = ['tanker_fill.recorded', 'tanker_fill.voided'];

    public function index(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'fuel_station_id' => ['nullable', 'uuid'],
            'subject_type' => ['nullable', 'string', 'in:FuelStation,FuelProduct,FuelTank,FuelPump,FuelNozzle,FuelStationDevice,FuelDelivery,FuelTankReading,FuelTankReadingRequest,FuelTankerOwner,FuelTanker,FuelTankerOwnerCompanyLink,FuelTankerFill,FuelOpeningBalance'],
            'subject_id' => ['nullable', 'uuid'],
            'actor_id' => ['nullable', 'uuid'],
            'action' => ['nullable', 'string', 'max:80'],
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date', 'after_or_equal:from'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $query = FuelStationAuditEvent::query()->with('actor:id,name')->orderByDesc('occurred_at')->orderByDesc('id');
        $this->restrictEventsToUserScope($query, $request);
        $this->restrictTankerSubjects($query, $request);
        $this->restrictTankerFillSubjects($query, $request);
        $this->restrictOpeningBalanceSubjects($query);
        if (! empty($filters['fuel_station_id'])) {
            $query->where('fuel_station_id', $filters['fuel_station_id']);
        }
        if (! empty($filters['subject_type'])) {
            $query->where('subject_type', 'App\\Models\\'.$filters['subject_type']);
        }
        foreach (['subject_id', 'actor_id', 'action'] as $key) {
            if (! empty($filters[$key])) {
                $query->where($key, $filters[$key]);
            }
        }
        if (! empty($filters['from'])) {
            $query->where('occurred_at', '>=', Carbon::parse($filters['from']));
        }
        if (! empty($filters['to'])) {
            // تاريخ فقط ⇒ نهاية اليوم؛ طابع زمني كامل ⇒ كما هو (لا لصق نص على طابع موجود).
            $to = Carbon::parse($filters['to']);
            $query->where('occurred_at', '<=', preg_match('/^\d{4}-\d{2}-\d{2}$/', trim($filters['to'])) ? $to->endOfDay() : $to);
        }

        return FuelStationAuditEventResource::collection($query->paginate((int) ($filters['per_page'] ?? 50)))->response();
    }

    /** أحداث أصحاب الصهاريج تظهر فقط لمن يملك `fuel.tanker.manage` **والبوابة مفتوحة**؛ غيره لا يراها (بما فيها ما كُتب قبل إغلاق البوابة). */
    private function restrictTankerSubjects(Builder $query, Request $request): void
    {
        $user = $request->user();
        $allowed = (bool) config('fuel_stations.tanker_management_enabled', false)
            && $user !== null && Rbac::allows((string) $user->role, 'fuel.tanker.manage');
        if (! $allowed) {
            $query->whereNotIn('subject_type', self::TANKER_SUBJECTS);
        }
    }

    /**
     * TANKER-SEC-1: أحداث سندات التعبئة ومرفقاتها (موضوعها `FuelTankerFill`). لقطاتها تحوي الكمية والسند الورقي والملاحظات وبيانات المرفقات، ومحكومة
     * في مساراتها ببوابتَي PR-1 وPR-4 معاً وبصلاحية `fuel.tanker.fill.view` — فلا يكفي لقراءتها `fuel_stations.manage` المطلوب لهذا المسار.
     * البوابتان مغلقتان ⇒ لا يراها أحد (بمن فيهم المالك) حتى ما كُتب قبل الإغلاق. غير حدثَي السند الأساسيين (`recorded|voided`) — أي كل أحداث
     * المرفقات الحالية والمستقبلية — يتطلب أيضاً `fuel.tanker.fill.attachment.remove` كما تتطلبه قراءة السجل التاريخي للمرفقات (قائمة سماح: `FILL_VIEW_ACTIONS`). السجل الأصلي لا يُمسّ؛ التصفية على القراءة فقط. نطاق المحطة/الفرع يطبّقه `restrictEventsToUserScope`.
     */
    private function restrictTankerFillSubjects(Builder $query, Request $request): void
    {
        $user = $request->user();
        $role = (string) $user?->role;
        $canView = (bool) config('fuel_stations.tanker_management_enabled', false)
            && (bool) config('fuel_stations.tanker_fills_enabled', false)
            && $user !== null && Rbac::allows($role, 'fuel.tanker.fill.view');
        if (! $canView) {
            $query->where('subject_type', '!=', FuelTankerFill::class);

            return;
        }
        if (! Rbac::allows($role, 'fuel.tanker.fill.attachment.remove')) {
            $query->where(fn (Builder $q) => $q->where('subject_type', '!=', FuelTankerFill::class)->orWhereIn('action', self::FILL_VIEW_ACTIONS));
        }
    }

    /**
     * FUEL-OPEN-AUDIT-SEC (#2114): بوابة الرصيد الافتتاحي تحكم قراءة أحداثه
     * كما تحكم مسارات مستنداته. لا نُغيّر أو نمسح السجل الأصلي.
     * حجب التكلفة داخل before/after يتم في FuelStationAuditEventResource
     * باستخدام سلطة التكلفة نفسها التي تحكم FuelOpeningBalanceResource.
     */
    private function restrictOpeningBalanceSubjects(Builder $query): void
    {
        if (! FuelOpeningBalanceService::enabled()) {
            $query->where('subject_type', '!=', FuelOpeningBalance::class);
        }
    }

    /**
     * نطاق الفرع/المخزن على مستوى **الحدث** (لقطة وقت الحدث) لا على وجود المحطة اليوم: حذف محطة لا يُخفي تاريخها عن
     * مدير نطاقها. نفس قاعدة `accessibleStationsQuery`: الفرع/المخزن الفارغان يبقيان مرئيين؛ وأحداث بلا محطة (منتج وقود)
     * لغير المقيَّد فقط.
     */
    private function restrictEventsToUserScope(Builder $query, Request $request): void
    {
        $branches = $request->user()?->allowedBranchIds();
        $warehouses = $request->user()?->allowedWarehouseIds();
        $assigned = $request->user()?->allowedFuelStationIds();
        if ($branches === null && $warehouses === null && $assigned === null) {
            return;
        }

        $query->whereNotNull('fuel_station_id');
        if ($assigned !== null) {
            $query->whereIn('fuel_station_id', $assigned); // FUEL-B3: المحطات المسنَدة فقط (`[]` ⇒ لا حدث).
        }
        if ($branches !== null) {
            $query->where(fn (Builder $q) => $q->whereIn('branch_id', $branches)->orWhereNull('branch_id'));
        }
        if ($warehouses !== null) {
            $query->where(fn (Builder $q) => $q->whereNull('warehouse_id')->orWhereIn('warehouse_id', $warehouses));
        }
    }
}
