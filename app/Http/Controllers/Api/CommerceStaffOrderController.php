<?php

namespace App\Http\Controllers\Api;

use App\Models\CommerceOrder;
use App\Models\CommerceOrderFulfillment;
use App\Models\CommerceOrderEvent;
use App\Models\CommerceOrderPosting;
use App\Models\CommercePaymentIntent;
use App\Models\PaymentAttempt;
use App\Models\Tenant;
use App\Models\User;
use App\Services\Commerce\CommerceOrderAttentionQuery;
use App\Services\Commerce\CommerceOrderFulfillmentService;
use App\Services\Commerce\CommerceOrderLifecycleService;
use App\Services\Commerce\CommerceOrderStatusProjector;
use App\Services\Commerce\CommerceOrderWarehouseScope;
use App\Support\CommerceOrderStaffSerializer;
use App\Tenancy\TenantContext;
use Carbon\Carbon;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * COMMERCE-ORDERS-O1a — قراءة طلبات المتجر للموظف (قائمة + تفاصيل). **قراءة فقط بالكامل.**
 *
 * - لا تغيير حالة طلب/دفع/تنفيذ، لا حجز ولا حركة مخزون ولا قيد ولا إشعار. لا يستدعي أي خدمة كتابة.
 * - الصلاحية `commerce.orders.view` (owner/admin عبر `*` فقط) + `EnsureApplicationActive:commerce.storefront`
 *   على المسار. استعلامات `CommerceOrder` تمرّ بـ`TenantScope`؛ طلب مستأجر آخر ⇒ 404 مطابق لغير الموجود (IDOR).
 * - **المستخدم المقيَّد بمخازن (COPS-H2-2، D-H2-11):** يرى طلبات مخازنه فقط عبر **المخزن الفعّال** (تنفيذ ← حجز ← سياسة القناة الحالية ← لا شيء=غير
 *   مرئي، فشل مغلق) — {@see CommerceOrderWarehouseScope}؛ طلب خارج نطاقه ⇒ 404 موحَّد. (كان 403 قبل H2-2.) التغذية تبقى 403 له.
 * - البحث والفلاتر والفرز بقائمة بيضاء حصراً؛ الترقيم محدود (≤ 50). لا يستقبل معرّف مستأجر من العميل.
 * - لا يغيّر العقد العام (`CommerceOrderSerializer`)؛ مسلسل الموظف منفصل (`CommerceOrderStaffSerializer`).
 */
class CommerceStaffOrderController extends ApiController
{
    private const MAX_PER_PAGE = 50;

    private const SORTS = ['created_at', 'total', 'number'];

    /** COPS-H1-5: `awaiting_acceptance` بانتظار قبول يدوي · `accepted` قُبل يدوياً · `auto` قبوله تلقائي (ضمني). */
    public const ACCEPTANCE_STATUSES = ['awaiting_acceptance', 'accepted', 'auto'];

    public function index(Request $request): JsonResponse
    {
        $this->guard($request);

        $data = $request->validate([
            'q' => ['sometimes', 'string', 'min:2', 'max:100'],
            'storefront_id' => ['sometimes', 'uuid'],
            'sales_channel_id' => ['sometimes', 'uuid'],
            'status' => ['sometimes', Rule::in([CommerceOrder::STATUS_DRAFT, CommerceOrder::STATUS_CONFIRMED])],
            'lifecycle_status' => ['sometimes', Rule::in([CommerceOrder::STATUS_DRAFT, CommerceOrder::STATUS_CONFIRMED, CommerceOrder::LIFECYCLE_CANCELLED])],
            // COPS-H1-5: مرشّح حالة القبول التشغيلية (بُعد مستقل عن الدورة والدفع والتنفيذ). انظر {@see self::applyAcceptanceFilter()}.
            'acceptance_status' => ['sometimes', Rule::in(self::ACCEPTANCE_STATUSES)],
            // COPS-H2-1: مرشّح حالة التنفيذ من الحقائق المخزَّنة (قائمة بيضاء؛ `not_started` = لا صف). يعمل دائماً أياً كان وضع بوابة التنفيذ (AR-3).
            'fulfillment_status' => ['sometimes', Rule::in([...CommerceOrderFulfillment::STATUSES, 'not_started'])],
            'payment_status' => ['sometimes', Rule::in([
                CommercePaymentIntent::STATUS_PENDING,
                CommercePaymentIntent::STATUS_AWAITING_COLLECTION,
                CommercePaymentIntent::STATUS_COLLECTED,
                CommercePaymentIntent::STATUS_PAID,
                CommercePaymentIntent::STATUS_CANCELLED,
            ])],
            'payment_method' => ['sometimes', Rule::in(CommercePaymentIntent::ALL_METHODS)],
            'delivery_method' => ['sometimes', Rule::in(['standard', 'pickup'])],
            'from' => ['sometimes', 'date_format:Y-m-d'],
            'to' => ['sometimes', 'date_format:Y-m-d', 'after_or_equal:from'],
            'sort' => ['sometimes', Rule::in(self::SORTS)],
            'direction' => ['sometimes', Rule::in(['asc', 'desc'])],
            'page' => ['sometimes', 'integer', 'min:1', 'max:100000'],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:'.self::MAX_PER_PAGE],
        ]);

        $query = self::scopedOrders($request->user())
            ->with(['salesChannel:id,name,type', 'storefront:id,name', 'snapshot', 'paymentIntent', 'fulfillment'])
            ->withCount('lines');

        $this->applyFilters($query, $data);

        $sort = $data['sort'] ?? 'created_at';
        $direction = $data['direction'] ?? 'desc';
        $page = $query->orderBy($sort, $direction)->orderBy('id', $direction)
            ->paginate((int) ($data['per_page'] ?? 20));

        $currency = $this->currency();

        return response()->json([
            'data' => $page->getCollection()
                ->map(fn (CommerceOrder $o) => CommerceOrderStaffSerializer::summary($o, $currency))
                ->values()->all(),
            'meta' => [
                'current_page' => $page->currentPage(),
                'per_page' => $page->perPage(),
                'total' => $page->total(),
                'last_page' => $page->lastPage(),
            ],
        ]);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $this->guard($request);

        return response()->json(['data' => $this->detailData($id, $request->user())]);
    }

    /**
     * تفاصيل الموظف لطلب (قراءة فقط) — يعيد استعمالها مسار الإلغاء (O3a-2b) فتخرج الاستجابة بالمسلسل نفسه. `$actor` يضيف `cancel_action` (O3b). 404 لغير الموجود/مستأجر آخر.
     *
     * @return array<string, mixed>
     */
    public function detailData(string $id, ?User $actor = null): array
    {
        $order = self::scopedOrders($actor)
            ->with([
                'salesChannel:id,name,type', 'storefront:id,name', 'snapshot', 'gift', 'schedule',
                'paymentIntent', 'lines.personalizations', 'cancelledBy:id,name', 'acceptedBy:id,name', 'fulfillment.warehouse:id,name',
            ])
            ->withCount('lines')
            ->find($id);
        abort_if($order === null, 404, 'الطلب غير موجود.');

        $intent = $order->paymentIntent;
        $attempts = $intent !== null && $intent->isOnline()
            ? PaymentAttempt::query()->where('payable_key', $intent->payableKey())->orderByDesc('created_at')->limit(20)->get()
            : collect();
        $posting = CommerceOrderPosting::query()->where('commerce_order_id', $order->id)->first();
        // COPS-H1-1: الخط الزمني — استعلامان ثابتان (الأحداث + أسماء الموظفين الفاعلين) مهما كثرت الأحداث. سقف 200 حدث.
        $events = CommerceOrderEvent::query()->where('commerce_order_id', $order->id)->orderBy('feed_seq')->limit(200)->get();
        $actorIds = $events->where('actor_type', CommerceOrderEvent::ACTOR_USER)->pluck('actor_id')->filter()->unique()->values();
        $userNames = $actorIds->isEmpty() ? [] : User::query()->withTrashed()->where('tenant_id', $order->tenant_id)->whereIn('id', $actorIds)->pluck('name', 'id')->all();

        $data = CommerceOrderStaffSerializer::detail($order, $this->currency(), $attempts, $posting, $events, $userNames);
        // O3b: عقد قراءة لإجراء الإلغاء — يغيب كلياً (لا مفتاح) حين البوابة مغلقة أو لا صلاحية؛ استرشادي والقرار لـAPI الإلغاء.
        $action = $actor === null ? null : app(CommerceOrderLifecycleService::class)->cancelAction($order, $actor);
        if ($action !== null) {
            $data['cancel_action'] = $action;
        }
        // COPS-H1-4: إجراءا القبول والرفض بالعقد نفسه — يغيبان (لا مفتاح) حين البوابة/البوابتان مغلقة أو تنقص الصلاحية؛ استرشاديان.
        if ($actor !== null) {
            $lifecycle = app(CommerceOrderLifecycleService::class);
            if (($accept = $lifecycle->acceptAction($order, $actor)) !== null) {
                $data['accept_action'] = $accept;
            }
            if (($reject = $lifecycle->rejectAction($order, $actor)) !== null) {
                $data['reject_action'] = $reject;
            }
        }

        // COPS-H2-1: إجراءات التنفيذ التالية بالعقد نفسه — تغيب (لا مفتاح) حين بوابة التنفيذ مغلقة أو تنقص `commerce.orders.manage`؛ استرشادية.
        // الحقائق المخزَّنة (كتلة `fulfillment`) لا تتأثر بالبوابة أبداً (AR-3).
        if ($actor !== null && (bool) config('commerce.order_fulfillment_enabled') && $actor->hasPermission('commerce.orders.manage')) {
            $data['fulfillment_actions'] = app(CommerceOrderFulfillmentService::class)->actions($order);
        }

        return $data;
    }

    /** @param array<string, mixed> $f */
    private function applyFilters(Builder $query, array $f): void
    {
        foreach (['storefront_id', 'sales_channel_id', 'status', 'delivery_method'] as $column) {
            if (isset($f[$column])) {
                $query->where($column, $f[$column]);
            }
        }
        // ADR-28: مرشِّح دورة الحياة المشتقّة. `status` الخام (أعلاه) لا يتغيّر معناه فيشمل `confirmed` الطلبات الملغاة كما كان قبل O3a-1.
        if (isset($f['lifecycle_status'])) {
            if ($f['lifecycle_status'] === CommerceOrder::LIFECYCLE_CANCELLED) {
                $query->whereNotNull('cancelled_at');
            } else {
                $query->where('status', $f['lifecycle_status'])->whereNull('cancelled_at');
            }
        }
        if (isset($f['acceptance_status'])) {
            $this->applyAcceptanceFilter($query, $f['acceptance_status']);
        }
        if (isset($f['fulfillment_status'])) {
            $f['fulfillment_status'] === 'not_started'
                ? $query->whereDoesntHave('fulfillment')
                : $query->whereHas('fulfillment', fn (Builder $q) => $q->where('status', $f['fulfillment_status']));
        }
        if (isset($f['payment_status']) || isset($f['payment_method'])) {
            $query->whereHas('paymentIntent', function (Builder $q) use ($f): void {
                if (isset($f['payment_status'])) {
                    $q->where('status', $f['payment_status']);
                }
                if (isset($f['payment_method'])) {
                    $q->where('method', $f['payment_method']);
                }
            });
        }
        if (isset($f['from'])) {
            $query->where('created_at', '>=', Carbon::createFromFormat('Y-m-d', $f['from'])->startOfDay());
        }
        if (isset($f['to'])) {
            $query->where('created_at', '<=', Carbon::createFromFormat('Y-m-d', $f['to'])->endOfDay());
        }
        if (isset($f['q'])) {
            $like = '%'.addcslashes(trim($f['q']), '\\%_').'%';
            $query->where(function (Builder $q) use ($like): void {
                $q->where('number', 'like', $like)
                    ->orWhereHas('snapshot', fn (Builder $s) => $s
                        ->where('customer_name', 'like', $like)
                        ->orWhere('contact_name', 'like', $like)
                        ->orWhere('phone', 'like', $like)
                        ->orWhere('email', 'like', $like));
            });
        }
    }

    /**
     * COPS-H1-5 — مرشّح حالة القبول **من الحقائق الأصلية** (لا من عمود حالة): يطابق {@see CommerceOrderStatusProjector} حرفياً لـ`awaiting_acceptance`
     * (مؤكَّد · غير ملغى · لقطة `manual` والبوابة مفتوحة · لم يُقبل · الدفع جاهز بقائمة R-5 الواحدة). لا يخلط الدفع بالقبول: الطلب اليدوي غير المدفوع
     * إلكترونياً لا يظهر في أي من الثلاثة (حالته `awaiting_payment` في المُسقِط).
     *
     *  - `awaiting_acceptance`: كما سبق.
     *  - `accepted`: قُبل يدوياً (`accepted_at` موجود) — حقيقة ثابتة لا تتأثر بالبوابة.
     *  - `auto`: قبوله ضمني — لم يُقبل يدوياً ولا يحتاج قبولاً الآن: لقطة NULL (التاريخي وما أُنشئ والبوابة مغلقة) أو لقطة `manual` والبوابة مغلقة.
     */
    private function applyAcceptanceFilter(Builder $query, string $status): void
    {
        $gateOpen = (bool) config('commerce.order_acceptance_enabled');

        match ($status) {
            'awaiting_acceptance' => $gateOpen
                ? $query->where('status', CommerceOrder::STATUS_CONFIRMED)
                    ->whereNull('cancelled_at')
                    ->where('acceptance_mode', CommerceOrder::ACCEPTANCE_MANUAL)
                    ->whereNull('accepted_at')
                    ->whereHas('paymentIntent', fn (Builder $q) => $q->whereIn('status', CommerceOrderAttentionQuery::PAYMENT_READY))
                : $query->whereRaw('1 = 0'),
            'accepted' => $query->whereNotNull('accepted_at'),
            default => $query->whereNull('accepted_at')->where(
                fn (Builder $q) => $gateOpen
                    ? $q->whereNull('acceptance_mode')
                    : $q->whereNull('acceptance_mode')->orWhere('acceptance_mode', CommerceOrder::ACCEPTANCE_MANUAL)
            ),
        };
    }

    /**
     * COPS-H2-2 (D-H2-11): المستخدم المقيَّد بمخازن لم يعد يُرفض 403 — يرى طلبات مخازنه فقط (المخزن الفعّال، {@see CommerceOrderWarehouseScope}) وطلب خارج
     * نطاقه ⇒ 404 موحَّد. تُبقي هذه الدالة اسمها للمستدعين (متحكّمات الإجراءات) لكنها لا ترفض؛ التصفية في {@see self::scopedOrders()}.
     */
    public function guard(Request $request): void
    {
        // مقصود: لا رفض. الرؤية بالنطاق لا بالمنع (H2-2).
    }

    /**
     * استعلام الطلبات مقيَّداً بنطاق مخازن المستخدم (غير المقيَّد: بلا تصفية). نقطة الدخول الوحيدة لأي بحث عن طلب بمعرّفه من متحكّمات الموظف.
     *
     * @return Builder<CommerceOrder>
     */
    public static function scopedOrders(?User $user): Builder
    {
        return CommerceOrderWarehouseScope::apply(CommerceOrder::query(), $user?->allowedWarehouseIds());
    }

    private function currency(): string
    {
        return Tenant::findOrFail(app(TenantContext::class)->id())->currency;
    }
}
