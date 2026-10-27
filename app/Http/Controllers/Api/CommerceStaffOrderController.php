<?php

namespace App\Http\Controllers\Api;

use App\Models\CommerceOrder;
use App\Models\CommerceOrderPosting;
use App\Models\CommercePaymentIntent;
use App\Models\PaymentAttempt;
use App\Models\Tenant;
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
 * - **المستخدم المقيَّد بمخازن يُرفض (403 fail-closed):** الطلب `CompanyWide` ولا يحمل مخزناً، فلا نطاق رؤية صحيح
 *   يمكن إثباته له. يُرفع القيد في مرحلة التنفيذ (F1) حين تحمل الشحنة المخزن.
 * - البحث والفلاتر والفرز بقائمة بيضاء حصراً؛ الترقيم محدود (≤ 50). لا يستقبل معرّف مستأجر من العميل.
 * - لا يغيّر العقد العام (`CommerceOrderSerializer`)؛ مسلسل الموظف منفصل (`CommerceOrderStaffSerializer`).
 */
class CommerceStaffOrderController extends ApiController
{
    private const MAX_PER_PAGE = 50;

    private const SORTS = ['created_at', 'total', 'number'];

    public function index(Request $request): JsonResponse
    {
        $this->guard($request);

        $data = $request->validate([
            'q' => ['sometimes', 'string', 'min:2', 'max:100'],
            'storefront_id' => ['sometimes', 'uuid'],
            'sales_channel_id' => ['sometimes', 'uuid'],
            'status' => ['sometimes', Rule::in([CommerceOrder::STATUS_DRAFT, CommerceOrder::STATUS_CONFIRMED])],
            'lifecycle_status' => ['sometimes', Rule::in([CommerceOrder::STATUS_DRAFT, CommerceOrder::STATUS_CONFIRMED, CommerceOrder::LIFECYCLE_CANCELLED])],
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

        $query = CommerceOrder::query()
            ->with(['salesChannel:id,name,type', 'storefront:id,name', 'snapshot', 'paymentIntent'])
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

        $order = CommerceOrder::query()
            ->with([
                'salesChannel:id,name,type', 'storefront:id,name', 'snapshot', 'gift', 'schedule',
                'paymentIntent', 'lines.personalizations', 'cancelledBy:id,name',
            ])
            ->withCount('lines')
            ->find($id);
        abort_if($order === null, 404, 'الطلب غير موجود.');

        $intent = $order->paymentIntent;
        $attempts = $intent !== null && $intent->isOnline()
            ? PaymentAttempt::query()->where('payable_key', $intent->payableKey())->orderByDesc('created_at')->limit(20)->get()
            : collect();
        $posting = CommerceOrderPosting::query()->where('commerce_order_id', $order->id)->first();

        return response()->json([
            'data' => CommerceOrderStaffSerializer::detail($order, $this->currency(), $attempts, $posting),
        ]);
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

    private function guard(Request $request): void
    {
        if ($request->user()?->allowedWarehouseIds() !== null) {
            abort(403, 'عرض طلبات المتجر غير متاح للمستخدم المقيَّد بمخازن محددة.');
        }
    }

    private function currency(): string
    {
        return Tenant::findOrFail(app(TenantContext::class)->id())->currency;
    }
}
