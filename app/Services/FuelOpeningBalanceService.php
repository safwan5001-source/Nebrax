<?php

namespace App\Services;

use App\Models\FuelInventoryCostMovement;
use App\Models\FuelInventoryCostState;
use App\Models\FuelOpeningBalance;
use App\Models\FuelOpeningBalanceLine;
use App\Models\FuelOperationalLedger;
use App\Models\FuelProduct;
use App\Models\FuelStation;
use App\Models\FuelTank;
use App\Models\Product;
use App\Models\ProductWarehouseStock;
use App\Models\StockMovement;
use App\Models\User;
use App\Models\Warehouse;
use App\Services\Accounting\AccountRoleResolver;
use App\Services\Accounting\InventoryService;
use App\Services\Accounting\LedgerService;
use App\Support\FuelDeliveryCostAuthority;
use App\Support\FuelOpeningValuation;
use App\Support\Rbac;
use App\Tenancy\BranchScope;
use Carbon\CarbonImmutable;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Database\UniqueConstraintViolationException;
use RuntimeException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  FuelOpeningBalanceService — رصيد افتتاحي للوقود: مسودة ← معاينة ← ترحيل
 * ═══════════════════════════════════════════════════════════════
 *  يؤسّس رصيد مجمّع (مخزن × منتج وقود) **فارغ وبلا تاريخ** بكميات لكل خزان وتكلفة لكل منتج، عبر الأولّيات القائمة فقط:
 *  `InventoryService::applyReceipt` (بوسم FUEL_POOL_META) + `FuelCostBasisService` (تهيئة حالة التكلفة بصورة صحيحة) +
 *  `LedgerService::post` (قيد واحد للمستند) + صف `opening` في الدفتر التشغيلي لكل خزان.
 *
 *  لا مورد، لا استلام، لا فاتورة شراء، لا GRNI. والرصيد الافتتاحي **ليس تسوية**: مجمّع غير فارغ أو له أي تاريخ حركة يُرفض
 *  (التصحيح بالجرد/الاستلام).
 *
 *  القيد (واحد للمستند):
 *    مدين  دور `inventory_asset`                         = Σ قيم السطور
 *    دائن  حساب حقوق الملكية `fuel_opening_balance_account_id` (إعداد صريح، بلا دور معتمد ولا fallback ولا كود ثابت)
 *
 *  ترتيب الأقفال (FUEL-LOCK-ORDER-2): المستند ← المحطة ← **الخزانات (بالمعرّف)** ← **مِرساة المستأجر** ← حالة التكلفة (assertReady، بمعرّف المنتج) ← المنتجات (بالمعرّف)
 *  ← صفوف رصيد المخزن ← القيد. هو ترتيب ERP نفسه (مِرساة ← مجمّع) فلا جمود مع إنهاء بيع على أي محطة تشترك في المجمّع، ومع اعتماد الاستلام وتسوية الخزان
 *  (كلها تأخذ المِرساة أولاً فتتسلسل عندها). وقفل المحطة أولاً يسلسل الترحيل مع بيع المحطة نفسها (finalize يقفلها أولاً أيضاً).
 */
class FuelOpeningBalanceService
{
    public const POST_PERMISSION = 'fuel.governance.manage';

    /** سقف سطور المستند (خزانات المحطة الواقعية أقل بكثير). */
    private const MAX_LINES = 50;

    public function __construct(
        private InventoryService $inventory,
        private LedgerService $ledger,
        private FuelStationSettingsService $settings,
        private FuelCostBasisService $costBasis,
        private FuelQuantity $quantity,
        private AccountRoleResolver $roles,
        private FuelStationAuditTrail $audit,
    ) {}

    public static function enabled(): bool
    {
        return (bool) config('fuel_stations.opening_balance_enabled', false);
    }

    // ───────────────────────────── المسودة ─────────────────────────────

    /**
     * @param  array<string, mixed>  $data  fuel_station_id, opening_date, idempotency_key, lines[{fuel_tank_id, quantity_liters}],
     *                                      costs?[{fuel_product_id, unit_cost_per_liter_minor}], allow_zero_cost?, notes?
     * @return array{document: FuelOpeningBalance, replayed: bool}
     */
    public function createDraft(array $data, User $actor): array
    {
        $this->assertEnabled();
        $key = trim((string) ($data['idempotency_key'] ?? ''));
        if ($key === '' || mb_strlen($key) > 128) {
            throw new RuntimeException('FUEL_OPENING_IDEMPOTENCY_REQUIRED: مفتاح idempotency مطلوب (حتى 128 حرفاً) لإنشاء مسودة الرصيد الافتتاحي.');
        }

        try {
            return DB::transaction(function () use ($data, $actor, $key) {
                $station = $this->stationFor($data['fuel_station_id'] ?? null, $actor);
                $normalized = $this->normalize($data, $station, $actor);
                $hash = $this->fingerprint($station, $normalized);

                $existing = FuelOpeningBalance::query()->where('idempotency_key', $key)->first();
                if ($existing !== null) {
                    return ['document' => $this->assertSameRequest($existing, $hash)->load('lines'), 'replayed' => true];
                }

                $document = FuelOpeningBalance::create([
                    'branch_id' => $station->branch_id,
                    'fuel_station_id' => $station->id,
                    'warehouse_id' => $station->warehouse_id,
                    'number' => FuelOpeningBalance::nextDocumentNumber('FOB', $this->settings->businessDate($station), $station->branch_id),
                    'opening_date' => $normalized['date'],
                    'status' => FuelOpeningBalance::STATUS_DRAFT,
                    'notes' => $normalized['notes'],
                    'allow_zero_cost' => $normalized['allow_zero_cost'],
                    'idempotency_key' => $key,
                    'request_hash' => $hash,
                    'total_milliliters' => array_sum(array_column($normalized['lines'], 'milliliters')),
                    'created_by' => $actor->id,
                ]);
                $this->writeLines($document, $station, $normalized['lines'], $normalized['costs']);
                $document->load('lines');
                $this->audit->record('opening_balance.created', $document, null, $this->audit->snapshot($document), $actor);

                return ['document' => $document, 'replayed' => false];
            });
        } catch (UniqueConstraintViolationException $e) {
            // طلبان متزامنان بمفتاح واحد: يفوز أحدهما ويعيد الآخر قراءته ومقارنته، لا 500 من فهرس القاعدة.
            $winner = FuelOpeningBalance::query()->where('idempotency_key', $key)->first();
            if ($winner === null) {
                throw new RuntimeException('FUEL_OPENING_DUPLICATE: مفتاح الرصيد الافتتاحي أو رقمه محجوز لسجل آخر.');
            }
            $station = $this->stationFor($data['fuel_station_id'] ?? null, $actor);
            $hash = $this->fingerprint($station, $this->normalize($data, $station, $actor));

            return ['document' => $this->assertSameRequest($winner, $hash)->load('lines'), 'replayed' => true];
        }
    }

    /**
     * استبدال كامل لمحتوى المسودة (PUT). `costs` غائبة ⇒ تبقى تكاليف المنتجات القائمة كما هي (من لا يملك سلطة التكلفة لا يمحوها).
     *
     * @param  array<string, mixed>  $data
     */
    public function updateDraft(FuelOpeningBalance $document, array $data, User $actor): FuelOpeningBalance
    {
        $this->assertEnabled();

        return DB::transaction(function () use ($document, $data, $actor) {
            $document = FuelOpeningBalance::lockForUpdate()->findOrFail($document->id);
            $this->assertDraft($document);
            $station = $this->stationFor($document->fuel_station_id, $actor);
            $before = $this->audit->snapshot($document->load('lines'));

            $data['fuel_station_id'] = $station->id;
            $preserved = null;
            if (! array_key_exists('costs', $data)) {
                $preserved = $document->lines->whereNotNull('unit_cost_per_liter_minor')
                    ->groupBy('fuel_product_id')->map(fn ($g) => (int) $g->first()->unit_cost_per_liter_minor)->all();
            }
            $normalized = $this->normalize($data, $station, $actor, $preserved);

            $document->lines()->delete();
            $document->update([
                'opening_date' => $normalized['date'],
                'notes' => $normalized['notes'],
                'allow_zero_cost' => $normalized['allow_zero_cost'],
                'total_milliliters' => array_sum(array_column($normalized['lines'], 'milliliters')),
                'request_hash' => $this->fingerprint($station, $normalized),
            ]);
            $this->writeLines($document, $station, $normalized['lines'], $normalized['costs']);
            $document = $document->fresh('lines');
            $this->audit->record('opening_balance.updated', $document, $before, $this->audit->snapshot($document), $actor);

            return $document;
        });
    }

    public function deleteDraft(FuelOpeningBalance $document, User $actor): void
    {
        $this->assertEnabled();
        DB::transaction(function () use ($document, $actor) {
            $document = FuelOpeningBalance::lockForUpdate()->findOrFail($document->id);
            $this->assertDraft($document);
            $this->stationFor($document->fuel_station_id, $actor);
            $snapshot = $this->audit->snapshot($document->load('lines'));
            $document->lines()->delete();
            $document->delete();
            $this->audit->record('opening_balance.deleted', $document, $snapshot, null, $actor);
        });
    }

    // ───────────────────────────── المعاينة ─────────────────────────────

    /**
     * معاينة **لا تكتب شيئاً ولا تقفل**: التقييم والموانع والتحذيرات والقيد المتوقع. فحص الفترة المحاسبية لا يدخلها لأنه يقفل
     * المِرساة (يجري عند الترحيل) ويُعلن ذلك صراحةً في `not_checked`.
     *
     * @return array<string, mixed>
     */
    public function preview(FuelOpeningBalance $document): array
    {
        $this->assertEnabled();
        $document->loadMissing('lines');
        if ($document->isPosted()) {
            return $this->postedSummary($document);
        }

        $evaluation = $this->evaluate($document, null, false);

        return [
            'ready' => $evaluation['blockers'] === [],
            'blockers' => $evaluation['blockers'],
            'warnings' => $evaluation['warnings'],
            'products' => array_values($evaluation['products']),
            'lines' => array_values($evaluation['lines']),
            'journal' => $evaluation['journal'],
            'total_milliliters' => (int) $document->lines->sum('quantity_milliliters'),
            'total_value_minor' => $evaluation['total_value'],
            'not_checked' => ['accounting_period_lock'],
        ];
    }

    // ───────────────────────────── الترحيل ─────────────────────────────

    /**
     * ترحيل المستند: حركات مخزون + حالة تكلفة + دفتر تشغيلي + قيد واحد، الكل أو لا شيء. إعادة الاستدعاء على مستند مرحَّل
     * تعيده كما هو (`replayed`) بلا أي أثر ثانٍ.
     *
     * @return array{document: FuelOpeningBalance, replayed: bool}
     */
    public function post(FuelOpeningBalance $document, User $actor): array
    {
        $this->assertEnabled();
        $this->assertPostAuthority($actor);

        return DB::transaction(function () use ($document, $actor) {
            $document = FuelOpeningBalance::lockForUpdate()->findOrFail($document->id);
            if ($document->isPosted()) {
                return ['document' => $document->load('lines'), 'replayed' => true];
            }

            // FUEL-LOCK-ORDER: NO KEY UPDATE (لا يتعارض مع KEY SHARE من FK صفوف الخزان/القراءات) — يمنع جموداً مع recordReading؛ انظر FuelSaleService::lockStation.
            $station = FuelStation::query()->lock('for no key update')->findOrFail($document->fuel_station_id);
            if (! $actor->canAccessFuelStation($station)) {
                throw new RuntimeException('محطة الرصيد الافتتاحي خارج نطاق صلاحياتك.');
            }
            // فصل المعتمِد عن المنشئ حين تلزم سياسة المحطة — داخل المعاملة وبعد قفل المستند وقبل أي أثر.
            $this->settings->assertDistinctApprover($station, $document->created_by, $actor->id, 'الرصيد الافتتاحي للوقود');

            $document->load('lines');
            $before = $this->audit->snapshot($document);

            // FUEL-LOCK-ORDER-2: **الخزانات أولاً ثم المِرساة.** `recordReading` يقفل الخزان `FOR UPDATE` ثم يُدرج قراءة تحتاج `KEY SHARE` على صف المستأجر (FK)، و`FOR UPDATE` على
            // المستأجر (المِرساة) يتعارض معه: أخذ المِرساة قبل الخزانات يعكس ترتيب القراءة فيجمد الترحيل مع تسجيل قراءة لأحد خزاناته (مراجعة Codex على #2071). فنقفل الخزانات
            // نفسها التي سيقفلها `evaluate()` بالترتيب نفسه (بالمعرّف) قبل المِرساة؛ ثم المِرساة قبل أي قفل مجمّع (ترتيب ERP: مِرساة ← حالة التكلفة ← الرصيد). لا أثر محاسبي أو مخزني.
            FuelTank::query()->whereIn('id', $document->lines->pluck('fuel_tank_id')->all())->orderBy('id')->lockForUpdate()->get();
            app(\App\Services\Accounting\AccountingDateGuard::class)->lockLedgerAnchor();

            // ترتيب الأقفال يطابق اعتماد الاستلام (حالة التكلفة ← المنتج ← الرصيد): assertReady أولاً، وإلا تعاكس مع استلام
            // يتسابق على المجمّع نفسه (يحمل أحدهما صف التكلفة وينتظر المنتج والآخر العكس ⇒ جمود). assertReady يرفض مخزوناً قائماً بلا
            // حالة تكلفة، فيتحوّل رفضه إلى مانع «المجمّع غير فارغ» لا خطأ عام. يُنشئ الحالة الصفرية لمجمّع فارغ وتتراجع مع أي رفض.
            $readiness = $station->warehouse_id === $document->warehouse_id ? Warehouse::query()->find($station->warehouse_id) : null;
            if ($readiness !== null) {
                $ids = $document->lines->pluck('fuel_product_id')->unique()->sort()->values()->all();
                foreach (FuelProduct::query()->whereIn('id', $ids)->orderBy('id')->get() as $fuelProduct) {
                    try {
                        $this->costBasis->assertReady($fuelProduct, $readiness);
                    } catch (RuntimeException) {
                        throw new FuelOpeningBalanceBlockedException([[
                            'code' => 'FUEL_OPENING_POOL_NOT_EMPTY', 'fuel_product_id' => $fuelProduct->id,
                            'message' => 'مجمّع الوقود فيه رصيد قائم بلا حالة تكلفة مدققة؛ الرصيد الافتتاحي لا يُسجَّل فوق رصيد.',
                        ]]);
                    }
                }
            }

            $evaluation = $this->evaluate($document, $station, true);
            if ($evaluation['blockers'] !== []) {
                throw new FuelOpeningBalanceBlockedException($evaluation['blockers']);
            }

            /** @var array<string, FuelProduct> $fuelProducts */
            $fuelProducts = $evaluation['context']['fuel_products'];
            /** @var array<string, Product> $products مفتاحها معرّف منتج الوقود (fuel_product_id) */
            $products = $evaluation['context']['products'];
            /** @var Warehouse $warehouse */
            $warehouse = $evaluation['context']['warehouse'];
            $date = $document->opening_date->toDateString();

            // حالة التكلفة أُنشئت وقُفلت أعلاه (قبل أي حركة) فلا يرفض recordReceipt مخزوناً قائماً بلا حالة.
            $movements = [];
            foreach ($document->lines as $line) {
                $value = (int) $evaluation['lines'][$line->id]['value_minor'];
                $quantity = (int) $line->quantity_milliliters;
                $movements[$line->id] = $this->inventory->applyReceipt(
                    $products[$line->fuel_product_id],
                    $quantity,
                    intdiv($value, $quantity),
                    [
                        'warehouse_id' => $warehouse->id,
                        'branch_id' => $station->branch_id,
                        'source_type' => FuelOpeningBalance::class,
                        'source_id' => $document->id,
                        'date' => $date,
                        'notes' => "رصيد افتتاحي للوقود {$document->number}",
                        InventoryService::FUEL_POOL_META => true,
                    ],
                    $value,
                );
            }

            // القيمة تُشتق من الحركات المُنشأة فعلاً (لا رقم يُعاد اشتقاقه) فيتطابق المخزون مع القيد هللةً بهللة.
            $total = (int) array_sum(array_map(fn (StockMovement $m) => (int) $m->total_cost, $movements));
            if ($total !== $evaluation['total_value']) {
                throw new RuntimeException('FUEL_OPENING_VALUE_MISMATCH: قيمة حركات المخزون لا تطابق التقييم المعاين؛ أُلغي الترحيل.');
            }

            $entry = null;
            if ($total > 0) {
                $entry = $this->ledger->post([
                    ['account_id' => $evaluation['context']['inventory_account']->id, 'debit' => $total, 'branch_id' => $station->branch_id],
                    ['account_id' => $evaluation['context']['opening_account']->id, 'credit' => $total, 'branch_id' => $station->branch_id],
                ], [
                    'entry_date' => $date,
                    'description' => "رصيد افتتاحي للوقود {$document->number}",
                    'source_type' => FuelOpeningBalance::class,
                    'source_id' => $document->id,
                    'created_by' => $actor->id,
                    'branch_id' => $station->branch_id,
                ]);
            }

            $occurredAt = CarbonImmutable::parse($date, $this->settings->operatingTimezone($station))->startOfDay();
            foreach ($document->lines as $line) {
                $movement = $movements[$line->id];
                $value = (int) $evaluation['lines'][$line->id]['value_minor'];
                $quantity = (int) $line->quantity_milliliters;
                $fuelProduct = $fuelProducts[$line->fuel_product_id];

                $this->costBasis->recordReceipt($fuelProduct, $warehouse, $movement, $quantity, $value, $entry);

                $balance = (int) (ProductWarehouseStock::query()
                    ->where('warehouse_id', $warehouse->id)->where('product_id', $fuelProduct->product_id)->value('quantity') ?? 0);
                $ledgerRow = FuelOperationalLedger::create([
                    'branch_id' => $station->branch_id,
                    'fuel_station_id' => $station->id,
                    'fuel_tank_id' => $line->fuel_tank_id,
                    'fuel_product_id' => $fuelProduct->id,
                    'warehouse_id' => $warehouse->id,
                    'stock_movement_id' => $movement->id,
                    'movement_type' => FuelOperationalLedger::TYPE_OPENING,
                    'quantity_milliliters' => $quantity,
                    'book_balance_milliliters' => $balance,
                    'unit_cost_minor' => intdiv($value, $quantity),
                    'value_minor' => $value,
                    'idempotency_key' => "fuel-opening:{$document->id}:{$line->fuel_tank_id}",
                    'source_type' => FuelOpeningBalance::class,
                    'source_id' => $document->id,
                    'occurred_at' => $occurredAt,
                    'notes' => "رصيد افتتاحي للوقود {$document->number}",
                ]);
                $line->update([
                    'unit_cost_per_liter_minor' => $evaluation['lines'][$line->id]['unit_cost_per_liter_minor'],
                    'value_minor' => $value,
                    'stock_movement_id' => $movement->id,
                    'fuel_operational_ledger_id' => $ledgerRow->id,
                ]);
            }

            // شرط لاحق: رصيد كل مجمّع = Σ كميات خزاناته المرحَّلة، وإلا تراجع كامل.
            foreach ($document->lines->groupBy('fuel_product_id') as $productId => $group) {
                $stock = (int) (ProductWarehouseStock::query()
                    ->where('warehouse_id', $warehouse->id)->where('product_id', $fuelProducts[$productId]->product_id)->sum('quantity'));
                if ($stock !== (int) $group->sum('quantity_milliliters')) {
                    throw new RuntimeException('FUEL_OPENING_BALANCE_MISMATCH: رصيد المجمّع لا يطابق كميات الخزانات بعد الترحيل؛ أُلغي الترحيل.');
                }
            }

            $document->update([
                'status' => FuelOpeningBalance::STATUS_POSTED,
                'total_milliliters' => (int) $document->lines->sum('quantity_milliliters'),
                'total_value_minor' => $total,
                'journal_entry_id' => $entry?->id,
                'posted_by' => $actor->id,
                'posted_at' => now(),
            ]);
            $document = $document->fresh('lines');
            $this->audit->record('opening_balance.posted', $document, $before, $this->audit->snapshot($document), $actor);

            return ['document' => $document, 'replayed' => false];
        });
    }

    // ───────────────────────────── التقييم والموانع ─────────────────────────────

    /**
     * يحسب الموانع والتحذيرات والتقييم والقيد المتوقع. بقفل (`$lock`) داخل معاملة الترحيل، وبدونه للمعاينة.
     * مصدر واحد للقواعد: المعاينة والترحيل يستعملان هذه الدالة نفسها فلا يختلفان.
     *
     * @return array{blockers: list<array<string,mixed>>, warnings: list<array<string,mixed>>, products: array<string,array<string,mixed>>, lines: array<string,array<string,mixed>>, journal: ?array<string,mixed>, total_value: int, context: array<string,mixed>}
     */
    private function evaluate(FuelOpeningBalance $document, ?FuelStation $lockedStation, bool $lock): array
    {
        $blockers = [];
        $warnings = [];
        $block = function (string $code, string $message, array $extra = []) use (&$blockers): void {
            $blockers[] = ['code' => $code, 'message' => $message] + $extra;
        };

        $station = $lockedStation ?? FuelStation::query()->find($document->fuel_station_id);
        $warehouse = null;
        if ($station === null || $station->status !== FuelStation::STATUS_ACTIVE) {
            $block('FUEL_OPENING_STATION_UNAVAILABLE', 'محطة الرصيد الافتتاحي غير موجودة أو غير نشطة.');
        } elseif ($station->branch_id !== $document->branch_id || $station->warehouse_id !== $document->warehouse_id) {
            $block('FUEL_OPENING_STATION_CHANGED', 'تغيّر فرع المحطة أو مخزنها بعد إنشاء المسودة؛ أنشئ مستنداً جديداً حتى يبقى التاريخ صادقاً.');
        } else {
            $warehouse = Warehouse::query()->find($station->warehouse_id);
            if ($warehouse === null || ! $warehouse->is_active || $warehouse->branch_id !== $station->branch_id) {
                $block('FUEL_OPENING_WAREHOUSE_UNAVAILABLE', 'مخزن المحطة غير موجود أو غير نشط أو لا يطابق فرعها.');
                $warehouse = null;
            }
        }

        $lines = $document->lines;
        if ($lines->isEmpty()) {
            $block('FUEL_OPENING_NO_LINES', 'لا يمكن ترحيل رصيد افتتاحي بلا سطور.');
        }

        $tankQuery = FuelTank::query()->whereIn('id', $lines->pluck('fuel_tank_id')->all())->orderBy('id');
        $tanks = ($lock ? $tankQuery->lockForUpdate() : $tankQuery)->get()->keyBy('id');
        $lineResults = [];
        foreach ($lines as $line) {
            $tank = $tanks[$line->fuel_tank_id] ?? null;
            $ref = ['tank_id' => $line->fuel_tank_id];
            if ($tank === null || $station === null || $tank->fuel_station_id !== $station->id) {
                $block('FUEL_OPENING_TANK_INVALID', 'الخزان غير موجود أو لا يخص محطة المستند.', $ref);
            } elseif ($tank->status !== FuelTank::STATUS_ACTIVE) {
                $block('FUEL_OPENING_TANK_INACTIVE', "الخزان «{$tank->name}» غير نشط.", $ref);
            } elseif ($tank->fuel_product_id !== $line->fuel_product_id) {
                $block('FUEL_OPENING_TANK_PRODUCT_CHANGED', "تغيّر منتج الخزان «{$tank->name}» بعد إنشاء المسودة.", $ref);
            } else {
                if ((int) $line->quantity_milliliters > (int) $tank->capacity_milliliters) {
                    $block('FUEL_OPENING_EXCEEDS_CAPACITY', "كمية الخزان «{$tank->name}» تتجاوز سعته.", $ref);
                } elseif ((int) $line->quantity_milliliters > (int) $tank->safe_capacity_milliliters) {
                    $warnings[] = ['code' => 'FUEL_OPENING_ABOVE_SAFE_CAPACITY', 'message' => "كمية الخزان «{$tank->name}» تتجاوز السعة الآمنة."] + $ref;
                }
            }
            $lineResults[$line->id] = [
                'line_id' => $line->id,
                'fuel_tank_id' => $line->fuel_tank_id,
                'tank_name' => $tank?->name,
                'fuel_product_id' => $line->fuel_product_id,
                'quantity_milliliters' => (int) $line->quantity_milliliters,
                'unit_cost_per_liter_minor' => $line->unit_cost_per_liter_minor === null ? null : (int) $line->unit_cost_per_liter_minor,
                'value_minor' => null,
            ];
        }

        // المنتجات (بالمعرّف تصاعدياً: ترتيب قفل ثابت).
        $productIds = $lines->pluck('fuel_product_id')->unique()->sort()->values()->all();
        $fuelProducts = FuelProduct::query()->whereIn('id', $productIds)->get()->keyBy('id');
        $productQuery = BranchScope::reference(Product::class)->whereIn('id', $fuelProducts->pluck('product_id')->all())->orderBy('id');
        $products = ($lock ? $productQuery->lockForUpdate() : $productQuery)->get()->keyBy('id');

        $productResults = [];
        $totalValue = 0;
        $costsComplete = true;
        foreach ($productIds as $fuelProductId) {
            $fuelProduct = $fuelProducts[$fuelProductId] ?? null;
            $product = $fuelProduct === null ? null : ($products[$fuelProduct->product_id] ?? null);
            $group = $lines->where('fuel_product_id', $fuelProductId)->values();
            $ref = ['fuel_product_id' => $fuelProductId];
            $sum = (int) $group->sum('quantity_milliliters');
            $cost = $group->first()->unit_cost_per_liter_minor;
            $cost = $cost === null ? null : (int) $cost;

            $entry = $ref + [
                'name' => $fuelProduct?->name,
                'total_milliliters' => $sum,
                'unit_cost_per_liter_minor' => $cost,
                'value_minor' => null,
                'pool' => null,
            ];

            if ($fuelProduct === null || $product === null || ! $fuelProduct->is_active || ! $product->track_inventory) {
                $block('FUEL_OPENING_PRODUCT_UNAVAILABLE', 'منتج الوقود غير موجود أو غير نشط أو لا يتتبّع مخزوناً.', $ref);
            } else {
                try {
                    $this->quantity->assertFuelUnitMapping($fuelProduct, $product);
                } catch (RuntimeException $e) {
                    $block('FUEL_OPENING_PRODUCT_UNIT_INVALID', $e->getMessage(), $ref);
                }
            }

            if ($cost === null) {
                $costsComplete = false;
                $block('FUEL_OPENING_COST_MISSING', 'تكلفة اللتر لم تُسجَّل لهذا المنتج؛ يلزم تسجيلها قبل الترحيل.', $ref);
            } elseif ($cost === 0 && ! $document->allow_zero_cost) {
                $block('FUEL_OPENING_ZERO_COST_NOT_ALLOWED', 'تكلفة اللتر صفر والمستند لا يحمل موافقة «السماح بتكلفة صفر».', $ref);
            }

            if ($warehouse !== null && $fuelProduct !== null && $product !== null) {
                $pool = $this->poolState($warehouse, $fuelProduct, $product, $lock);
                $entry['pool'] = $pool;
                if ($pool['stock_milliliters'] !== 0) {
                    $block('FUEL_OPENING_POOL_NOT_EMPTY', 'مجمّع الوقود (مخزن المحطة × المنتج) فيه رصيد قائم؛ الرصيد الافتتاحي لا يُسجَّل فوق رصيد. استخدم الجرد أو الاستلام.', $ref);
                } elseif ($pool['has_history']) {
                    $block('FUEL_OPENING_POOL_HAS_HISTORY', 'للمجمّع تاريخ حركات سابقة (' . implode('، ', $pool['history']) . ')؛ الرصيد الافتتاحي ليس تسوية. استخدم الجرد أو الاستلام.', $ref);
                }
            }

            if ($cost !== null) {
                try {
                    $values = FuelOpeningValuation::split($group->pluck('quantity_milliliters')->map(fn ($v) => (int) $v)->all(), $cost);
                    foreach ($group as $i => $line) {
                        $lineResults[$line->id]['value_minor'] = $values[$i];
                        $lineResults[$line->id]['unit_cost_per_liter_minor'] = $cost;
                    }
                    $entry['value_minor'] = array_sum($values);
                    $totalValue += $entry['value_minor'];
                } catch (RuntimeException $e) {
                    $block('FUEL_OPENING_VALUE_INVALID', $e->getMessage(), $ref);
                }
            }
            $productResults[$fuelProductId] = $entry;
        }

        // الحسابات: جانب الأصل بالدور المعتمد، والطرف المقابل بإعداد صريح (بلا افتراض).
        $inventoryAccount = null;
        $openingAccount = null;
        if ($station !== null) {
            try {
                $inventoryAccount = $this->roles->resolve('inventory_asset');
                if ($inventoryAccount->type !== 'asset' || $inventoryAccount->is_group || ! $inventoryAccount->is_active) {
                    throw new RuntimeException('invalid');
                }
            } catch (RuntimeException) {
                $inventoryAccount = null;
                $block('FUEL_OPENING_INVENTORY_ACCOUNT_INVALID', 'حساب مخزون الوقود (دور inventory_asset) غير معيَّن أو غير صالح للترحيل.');
            }
            try {
                $openingAccount = $this->settings->openingBalanceAccountFor($station);
            } catch (RuntimeException $e) {
                $block('FUEL_OPENING_ACCOUNT_REQUIRED', $e->getMessage());
            }
        }

        $journal = null;
        if ($blockers === [] && $costsComplete && $inventoryAccount !== null && $openingAccount !== null) {
            $journal = [
                'total_minor' => $totalValue,
                'posts' => $totalValue > 0,
                'debit' => ['account_id' => $inventoryAccount->id, 'code' => $inventoryAccount->code, 'name' => $inventoryAccount->name, 'role' => 'inventory_asset', 'amount_minor' => $totalValue],
                'credit' => ['account_id' => $openingAccount->id, 'code' => $openingAccount->code, 'name' => $openingAccount->name, 'setting' => 'fuel_opening_balance_account_id', 'amount_minor' => $totalValue],
            ];
        }

        return [
            'blockers' => $blockers,
            'warnings' => $warnings,
            'products' => $productResults,
            'lines' => $lineResults,
            'journal' => $journal,
            'total_value' => $totalValue,
            'context' => [
                'station' => $station,
                'warehouse' => $warehouse,
                'fuel_products' => $fuelProducts->all(),
                'products' => $fuelProducts->mapWithKeys(fn (FuelProduct $fp) => [$fp->id => $products[$fp->product_id] ?? null])->all(),
                'inventory_account' => $inventoryAccount,
                'opening_account' => $openingAccount,
            ],
        ];
    }

    /**
     * حالة المجمّع (مخزن × منتج) مع كل مؤشرات «التاريخ»: أي رصيد، أو أي حركة مخزون، أو حركة تكلفة، أو صف دفتر تشغيلي،
     * أو حالة تكلفة غير صفرية. القراءات تتجاوز عزل الفرع النشط (المجمّع مؤسسي) ويبقى عزل المستأجر.
     *
     * @return array{stock_milliliters:int, has_history:bool, history:list<string>}
     */
    private function poolState(Warehouse $warehouse, FuelProduct $fuelProduct, Product $product, bool $lock): array
    {
        $stockQuery = ProductWarehouseStock::query()->where('warehouse_id', $warehouse->id)->where('product_id', $product->id);
        if ($lock) {
            $stockQuery->lockForUpdate();
        }
        $stock = (int) $stockQuery->get()->sum('quantity');

        $history = [];
        if (StockMovement::query()->withoutGlobalScope(BranchScope::class)->where('warehouse_id', $warehouse->id)->where('product_id', $product->id)->exists()) {
            $history[] = 'حركة مخزون';
        }
        if (FuelInventoryCostMovement::query()->where('warehouse_id', $warehouse->id)->where('fuel_product_id', $fuelProduct->id)->exists()) {
            $history[] = 'حركة تكلفة وقود';
        }
        if (FuelOperationalLedger::query()->withoutGlobalScope(BranchScope::class)->where('warehouse_id', $warehouse->id)->where('fuel_product_id', $fuelProduct->id)->exists()) {
            $history[] = 'دفتر تشغيلي';
        }
        $state = FuelInventoryCostState::query()->where('warehouse_id', $warehouse->id)->where('fuel_product_id', $fuelProduct->id)->first();
        if ($state !== null && ((int) $state->quantity_milliliters !== 0 || (int) $state->cost_pool_minor !== 0)) {
            $history[] = 'حالة تكلفة غير صفرية';
        }

        return ['stock_milliliters' => $stock, 'has_history' => $history !== [], 'history' => $history];
    }

    // ───────────────────────────── التحقق والتطبيع ─────────────────────────────

    /**
     * @param  array<string,mixed>  $data
     * @param  array<string,int>|null  $preservedCosts  تكاليف قائمة (product_id ⇒ هللة/لتر) تُستبقى حين تغيب `costs`
     * @return array{date:string, notes:?string, allow_zero_cost:bool, lines:list<array{tank:FuelTank, milliliters:int}>, costs:array<string,int>}
     */
    private function normalize(array $data, FuelStation $station, User $actor, ?array $preservedCosts = null): array
    {
        $date = (string) ($data['opening_date'] ?? '');
        try {
            $parsed = CarbonImmutable::createFromFormat('!Y-m-d', $date);
        } catch (\Throwable) {
            $parsed = false;
        }
        if (! $parsed || $parsed->format('Y-m-d') !== $date) {
            throw new RuntimeException('FUEL_OPENING_DATE_INVALID: تاريخ الرصيد الافتتاحي مطلوب بصيغة YYYY-MM-DD.');
        }
        if ($date > $this->settings->businessDate($station)) {
            throw new RuntimeException('FUEL_OPENING_DATE_FUTURE: لا يُؤرَّخ الرصيد الافتتاحي بتاريخ مستقبلي.');
        }

        $rawLines = $data['lines'] ?? null;
        if (! is_array($rawLines) || $rawLines === [] || count($rawLines) > self::MAX_LINES) {
            throw new RuntimeException('FUEL_OPENING_LINES_INVALID: سطور الخزانات مطلوبة (1 إلى ' . self::MAX_LINES . ').');
        }
        $tankIds = array_map(fn ($l) => is_array($l) ? (string) ($l['fuel_tank_id'] ?? '') : '', $rawLines);
        if (count(array_unique($tankIds)) !== count($tankIds) || in_array('', $tankIds, true)) {
            throw new RuntimeException('FUEL_OPENING_LINES_INVALID: لكل خزان سطر واحد فقط ومعرّف الخزان مطلوب.');
        }
        $tanks = FuelTank::query()->whereIn('id', $tankIds)->get()->keyBy('id');
        $lines = [];
        foreach ($rawLines as $raw) {
            $tank = $tanks[(string) $raw['fuel_tank_id']] ?? null;
            if ($tank === null || $tank->fuel_station_id !== $station->id) {
                throw new RuntimeException('FUEL_OPENING_TANK_INVALID: الخزان غير موجود أو لا يخص المحطة المحددة.');
            }
            $liters = $raw['quantity_liters'] ?? null;
            if (! is_string($liters) && ! is_int($liters)) {
                throw new RuntimeException('FUEL_OPENING_QUANTITY_INVALID: كمية الخزان باللترات مطلوبة كنص أو عدد صحيح (حتى ثلاث منازل عشرية).');
            }
            $milliliters = $this->quantity->litersToMilliliters($liters);
            if ($milliliters <= 0) {
                throw new RuntimeException('FUEL_OPENING_QUANTITY_INVALID: كمية الخزان يجب أن تكون موجبة.');
            }
            $lines[] = ['tank' => $tank, 'milliliters' => $milliliters];
        }

        $productsInLines = array_values(array_unique(array_map(fn ($l) => $l['tank']->fuel_product_id, $lines)));
        $costs = [];
        if (array_key_exists('costs', $data) && $data['costs'] !== null) {
            if (! FuelDeliveryCostAuthority::canRecord($actor)) {
                throw new AuthorizationException('تسجيل تكلفة الرصيد الافتتاحي للوقود يتطلب سلطة التكلفة المالية.');
            }
            if (! is_array($data['costs'])) {
                throw new RuntimeException('FUEL_OPENING_COST_INVALID: التكاليف يجب أن تكون قائمة.');
            }
            foreach ($data['costs'] as $raw) {
                $productId = is_array($raw) ? (string) ($raw['fuel_product_id'] ?? '') : '';
                $minor = is_array($raw) ? ($raw['unit_cost_per_liter_minor'] ?? null) : null;
                if (! in_array($productId, $productsInLines, true) || isset($costs[$productId])) {
                    throw new RuntimeException('FUEL_OPENING_COST_INVALID: التكلفة لمنتج غير موجود في السطور أو مكررة.');
                }
                if (! is_int($minor) || $minor < 0) {
                    throw new RuntimeException('FUEL_OPENING_COST_INVALID: تكلفة اللتر عدد صحيح بالهللة غير سالب.');
                }
                $costs[$productId] = $minor;
            }
        } elseif ($preservedCosts !== null) {
            $costs = array_intersect_key($preservedCosts, array_flip($productsInLines));
        }

        $notes = isset($data['notes']) ? trim((string) $data['notes']) : null;

        return [
            'date' => $date,
            'notes' => ($notes === null || $notes === '') ? null : mb_substr($notes, 0, 1000),
            'allow_zero_cost' => (bool) ($data['allow_zero_cost'] ?? false),
            'lines' => $lines,
            'costs' => $costs,
        ];
    }

    /** @param array{date:string, notes:?string, allow_zero_cost:bool, lines:list<array{tank:FuelTank, milliliters:int}>, costs:array<string,int>} $n */
    private function fingerprint(FuelStation $station, array $n): string
    {
        $lines = array_map(fn ($l) => [$l['tank']->id, $l['milliliters']], $n['lines']);
        usort($lines, fn ($a, $b) => strcmp($a[0], $b[0]));
        $costs = $n['costs'];
        ksort($costs);

        return hash('sha256', json_encode([$station->id, $n['date'], $n['notes'], $n['allow_zero_cost'], $lines, $costs], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR));
    }

    private function assertSameRequest(FuelOpeningBalance $existing, string $hash): FuelOpeningBalance
    {
        if (! hash_equals((string) $existing->request_hash, $hash)) {
            throw new RuntimeException('FUEL_OPENING_IDEMPOTENCY_CONFLICT: مفتاح idempotency مستعمل سابقاً بمحتوى مختلف.');
        }

        return $existing;
    }

    /**
     * @param  list<array{tank:FuelTank, milliliters:int}>  $lines
     * @param  array<string,int>  $costs
     */
    private function writeLines(FuelOpeningBalance $document, FuelStation $station, array $lines, array $costs): void
    {
        foreach ($lines as $i => $line) {
            FuelOpeningBalanceLine::create([
                'branch_id' => $station->branch_id,
                'fuel_opening_balance_id' => $document->id,
                'fuel_tank_id' => $line['tank']->id,
                'fuel_product_id' => $line['tank']->fuel_product_id,
                'position' => $i + 1,
                'quantity_milliliters' => $line['milliliters'],
                'unit_cost_per_liter_minor' => $costs[$line['tank']->fuel_product_id] ?? null,
            ]);
        }
    }

    private function stationFor(mixed $stationId, User $actor): FuelStation
    {
        $station = FuelStation::query()->find((string) $stationId);
        if ($station === null) {
            throw new RuntimeException('FUEL_OPENING_STATION_UNAVAILABLE: محطة الوقود غير موجودة.');
        }
        if (! $actor->canAccessFuelStation($station)) {
            throw new RuntimeException('محطة الرصيد الافتتاحي خارج نطاق صلاحياتك.');
        }
        if ($station->status !== FuelStation::STATUS_ACTIVE || $station->branch_id === null || $station->warehouse_id === null) {
            throw new RuntimeException('FUEL_OPENING_STATION_UNAVAILABLE: الرصيد الافتتاحي يتطلب محطة نشطة بفرع ومخزن صريحين.');
        }

        return $station;
    }

    /** ملخص مستند مرحَّل (المعاينة لا تعيد التقييم عليه). @return array<string,mixed> */
    private function postedSummary(FuelOpeningBalance $document): array
    {
        return [
            'ready' => false,
            'posted' => true,
            'blockers' => [],
            'warnings' => [],
            'products' => [],
            'lines' => $document->lines->map(fn (FuelOpeningBalanceLine $l) => [
                'line_id' => $l->id, 'fuel_tank_id' => $l->fuel_tank_id, 'fuel_product_id' => $l->fuel_product_id,
                'quantity_milliliters' => (int) $l->quantity_milliliters,
                'unit_cost_per_liter_minor' => $l->unit_cost_per_liter_minor,
                'value_minor' => $l->value_minor,
            ])->all(),
            'journal' => null,
            'total_milliliters' => (int) $document->total_milliliters,
            'total_value_minor' => $document->total_value_minor,
            'not_checked' => [],
        ];
    }

    private function assertDraft(FuelOpeningBalance $document): void
    {
        if (! $document->isDraft()) {
            throw new RuntimeException('FUEL_OPENING_NOT_DRAFT: لا يُعدَّل ولا يُحذف رصيد افتتاحي مرحَّل.');
        }
    }

    private function assertEnabled(): void
    {
        if (! self::enabled()) {
            throw new RuntimeException('FUEL_OPENING_DISABLED: ميزة الرصيد الافتتاحي للوقود غير مفعَّلة على هذا النشر.');
        }
    }

    /** الترحيل: سلطة الحوكمة **و** سلطة التكلفة المالية (قرار D4 — بلا صلاحية جديدة). فحص خدمة لا يتجاوزه استدعاء داخلي. */
    private function assertPostAuthority(User $actor): void
    {
        if (! Rbac::allows((string) $actor->role, self::POST_PERMISSION) || ! FuelDeliveryCostAuthority::canRecord($actor)) {
            throw new AuthorizationException('ترحيل الرصيد الافتتاحي للوقود يتطلب صلاحية حوكمة الوقود وسلطة التكلفة المالية.');
        }
    }
}
