<?php

namespace App\Services\Accounting;

use App\Models\PosHeldSale;
use App\Models\PosSession;
use App\Models\User;
use App\Support\PosSettings;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * سلال البيع المعلّقة في POS. هي مسودات تشغيلية فقط ولا تنشئ فاتورة أو سنداً
 * أو حركة مخزون أو قيداً؛ يعود الأثر المالي حصراً إلى PosService عند الدفع.
 */
class PosHeldSaleService
{
    public function __construct(protected PosSessionService $sessions) {}

    /** @param array{pos_session_id:string,customer_id?:?string,tax_inclusive?:bool,items:array<int,array>} $data */
    public function hold(array $data, User $actor): PosHeldSale
    {
        if (empty($data['items'])) {
            throw new RuntimeException('لا يمكن تعليق سلة فارغة.');
        }

        return DB::transaction(function () use ($data, $actor) {
            $session = $this->sessions->requireOpenForCheckout($data['pos_session_id'], $actor->id, $actor);

            return PosHeldSale::create([
                'branch_id' => $session->branch_id,
                'pos_session_id' => $session->id,
                'warehouse_id' => $session->warehouse_id,
                'customer_id' => $data['customer_id'] ?? null,
                'held_by' => $actor->id,
                'status' => PosHeldSale::STATUS_HELD,
                'payload' => [
                    'tax_inclusive' => (bool) ($data['tax_inclusive'] ?? false),
                    'items' => array_map(static fn (array $item): array => [
                        'product_id' => $item['product_id'] ?? null,
                        'description' => $item['description'] ?? null,
                        'sku' => $item['sku'] ?? null,
                        'quantity' => (int) $item['quantity'],
                        'unit_price' => (int) $item['unit_price'],
                        'tax_rate' => (int) ($item['tax_rate'] ?? 0),
                        'discount' => (int) ($item['discount'] ?? 0),
                    ], $data['items']),
                ],
            ])->fresh(['customer']);
        });
    }

    /** @return Collection<int, PosHeldSale> */
    public function list(string $sessionId, User $actor): Collection
    {
        $session = $this->sessions->requireOpenForCheckout($sessionId, $actor->id, $actor);

        return $this->heldForSession($session, $actor)
            ->with('customer')
            ->orderByDesc('created_at')
            ->get();
    }

    /** يستأنف المسودة بقفل صفها حتى لا تتسلمها شاشتا كاشير في الوقت نفسه. */
    public function resume(string $id, string $sessionId, User $actor): PosHeldSale
    {
        return DB::transaction(function () use ($id, $sessionId, $actor) {
            $session = $this->sessions->requireOpenForCheckout($sessionId, $actor->id, $actor);
            $held = PosHeldSale::lockForUpdate()->findOrFail($id);
            $this->assertAccessible($held, $session, $actor);

            $held->update([
                'status' => PosHeldSale::STATUS_RESUMED,
                'resumed_pos_session_id' => $session->id,
                'resumed_at' => now(),
            ]);

            return $held->fresh('customer');
        });
    }

    /** يلغي مسودة غير مالية؛ لا توجد وثيقة مرحّلة أو قيد يستحق العكس. */
    public function discard(string $id, string $sessionId, User $actor): void
    {
        DB::transaction(function () use ($id, $sessionId, $actor) {
            $session = $this->sessions->requireOpenForCheckout($sessionId, $actor->id, $actor);
            $held = PosHeldSale::lockForUpdate()->findOrFail($id);
            $this->assertAccessible($held, $session, $actor);

            $held->update([
                'status' => PosHeldSale::STATUS_DISCARDED,
                'discarded_at' => now(),
            ]);
        });
    }

    /** @return \Illuminate\Database\Eloquent\Builder<PosHeldSale> */
    private function heldForSession(PosSession $session, User $actor)
    {
        $query = PosHeldSale::where('status', PosHeldSale::STATUS_HELD)
            ->where('held_by', $actor->id)
            ->where('warehouse_id', $session->warehouse_id);

        if (PosSettings::heldSaleClosePolicy() !== PosSettings::HELD_SALE_KEEP_FOR_NEXT_SESSION) {
            $query->where('pos_session_id', $session->id);
        }

        return $query;
    }

    private function assertAccessible(PosHeldSale $held, PosSession $session, User $actor): void
    {
        if ($held->status !== PosHeldSale::STATUS_HELD) {
            throw new RuntimeException('هذه السلة المعلّقة لم تعد قابلة للاستئناف.');
        }
        if ($held->held_by !== $actor->id) {
            throw new RuntimeException('هذه السلة المعلّقة تخص كاشيراً آخر.');
        }
        if ($held->warehouse_id !== $session->warehouse_id) {
            throw new RuntimeException('مخزن السلة المعلّقة لا يطابق مخزن جلسة الكاشير الحالية.');
        }
        if ($held->pos_session_id !== $session->id
            && PosSettings::heldSaleClosePolicy() !== PosSettings::HELD_SALE_KEEP_FOR_NEXT_SESSION) {
            throw new RuntimeException('إعدادات نقطة البيع لا تسمح باستئناف سلة من جلسة سابقة.');
        }
    }
}
