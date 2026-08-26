<?php

namespace App\Support;

use App\Models\Asset;
use App\Models\Branch;
use App\Models\CashBankTransfer;
use App\Models\CorporateFuelContract;
use App\Models\CreditNote;
use App\Models\DeliveryNote;
use App\Models\Employee;
use App\Models\EmployeeCustody;
use App\Models\EmployeeCustodySettlement;
use App\Models\Expense;
use App\Models\FuelShift;
use App\Models\FuelSale;
use App\Models\FuelStationSafetyInspection;
use App\Models\FuelStationWorkOrder;
use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\ManualJournal;
use App\Models\Payment;
use App\Models\PayrollRun;
use App\Models\PosSession;
use App\Models\Product;
use App\Models\ProcurementDocument;
use App\Models\Purchase;
use App\Models\Quote;
use App\Models\ReturnDocument;
use App\Models\StockPermit;
use App\Models\Stocktake;
use App\Models\Warehouse;

/**
 * ═══════════════════════════════════════════════════════════════
 *  فهرس الترقيم — وصفٌ للعرض، لا محرّكُ توليد
 * ═══════════════════════════════════════════════════════════════
 *  يصف الكيانات المرقّمة عبر `GeneratesDocumentNumbers`:
 *  سلاسلها وبادئاتها ونطاقها، ليعرضها المستخدمُ في مكانٍ واحد.
 *
 *  **لا يولّد رقماً ولا ينسخ منطقاً.** الرقم التالي يُقرأ باستدعاء الطبقة
 *  نفسها (`nextDocumentNumber`)، فما تعرضه الشاشة هو ما سيُنتجه النظام
 *  حرفياً — لا حسابٌ موازٍ يفترق عنه بصمت.
 *
 *  ═══ ما هو ثابتٌ اليوم وما هو مضبوط ═══
 *
 *  الطبقة تستقبل البادئة من مستدعيها، وتُصفّر الرقم بخمس خانات عشرية دائماً.
 *  فالتنسيق وعدد الأرقام **ثابتان في الطبقة** لا إعدادان — تُعرَض قيمتاهما
 *  للاطّلاع لا للتحرير. ومن الثمانية عشر، **خمس** تقرأ بادئتها من الإعدادات
 *  (الفاتورة · فاتورة الشراء · عرض السعر · الفرع · المخزن)؛ والبقية تمرّر
 *  ثوابت مكتوبة في خدماتها. لذلك حقل البادئة قابلٌ للتحرير في هذه الخمس
 *  وحدها، ومعطَّلٌ فيما عداها — الشاشة تعرض الواقع ولا تَعِد بما لا تملك تنفيذه.
 *
 *  وبادئتا الفرع والمخزن **افتراضهما فارغ**، فيبقى الكود `00001` كما كان.
 *
 *  التحويل من ثابتٍ إلى إعداد رخيصٌ ومتدرّج: مفتاحٌ في `Settings::DEFAULTS`،
 *  وقراءتُه في الخدمة، و`setting` هنا — فيصير الحقل قابلاً للتحرير تلقائياً
 *  في الطلب والشاشة معاً. لا تُمسّ الطبقة ولا `max()` ولا القفل.
 *
 *  ═══ ما لا يدخل هذا الفهرس أبداً ═══
 *
 *  **`invoices.zatca_icv` ليس رقم مستند** ولا يمرّ بطبقة الترقيم: عدّاد
 *  سلسلة إصدار ZATCA، نطاقه يُقرأ من `ZatcaIcvScope` وحده وله شاشته.
 *  لا يُضاف هنا مهما بدا متسقاً.
 */
class DocumentNumberingCatalog
{
    /** التنسيق وعدد الأرقام كما تفرضهما الطبقة اليوم — للعرض لا للضبط. */
    public const FORMAT  = 'numeric';
    public const PADDING = 5;

    /**
     * الكيانات المرقّمة.
     *
     *  - `series`  سلسلة أو أكثر لكل كيان: الجدول الواحد قد يحمل سلاسل
     *              مستقلّة يفصلها اختلاف البادئة (مبيعات/مشتريات، قبض/صرف…).
     *  - `yearly`  هل تُصفَّر السلسلة مع السنة؟ (الموظف والفرع والمخزن: لا)
     *  - `setting` مصدر البادئة إن كانت مضبوطة — وإلا فثابتٌ في الخدمة.
     */
    public const ENTITIES = [
        'product' => [
            'model'   => Product::class,
            'yearly'  => false,
            'setting' => ['group' => 'numbering', 'key' => 'product_prefix'],
            'series'  => [['key' => 'default', 'prefix' => 'SKU']],
        ],
        'invoice' => [
            'model'   => Invoice::class,
            'yearly'  => true,
            'setting' => ['group' => 'sales', 'key' => 'invoice_prefix'],
            'series'  => [['key' => 'default', 'prefix' => 'INV']],
        ],
        'delivery_note' => [
            'model'   => DeliveryNote::class,
            'yearly'  => true,
            'setting' => ['group' => 'sales', 'key' => 'delivery_note_prefix'],
            'series'  => [['key' => 'default', 'prefix' => 'DN']],
        ],
        'purchase' => [
            'model'   => Purchase::class,
            'yearly'  => true,
            'setting' => ['group' => 'purchases', 'key' => 'purchase_prefix'],
            'series'  => [['key' => 'default', 'prefix' => 'BILL']],
        ],
        'quote' => [
            'model'   => Quote::class,
            'yearly'  => true,
            'setting' => ['group' => 'sales', 'key' => 'quote_prefix'],
            'series'  => [['key' => 'default', 'prefix' => 'QUO']],
        ],
        'return' => [
            'model'  => ReturnDocument::class,
            'yearly' => true,
            'series' => [
                ['key' => 'sales', 'prefix' => 'SRET'],
                ['key' => 'purchase', 'prefix' => 'PRET'],
            ],
        ],
        'payment' => [
            'model'  => Payment::class,
            'yearly' => true,
            'series' => [
                ['key' => 'received', 'prefix' => 'REC'],
                ['key' => 'paid', 'prefix' => 'PAY'],
            ],
        ],
        'cash_bank_transfer' => [
            'model'  => CashBankTransfer::class,
            'yearly' => true,
            'series' => [['key' => 'default', 'prefix' => 'CBT']],
        ],
        'credit_note' => [
            'model'  => CreditNote::class,
            'yearly' => true,
            'series' => [
                ['key' => 'sales', 'prefix' => 'CN'],
                ['key' => 'purchase', 'prefix' => 'DN'],
            ],
        ],
        'procurement' => [
            'model'  => ProcurementDocument::class,
            'yearly' => true,
            'series' => [
                ['key' => 'request', 'prefix' => 'PR'],
                ['key' => 'rfq', 'prefix' => 'RFQ'],
                ['key' => 'quotation', 'prefix' => 'PQ'],
                ['key' => 'order', 'prefix' => 'PO'],
            ],
        ],
        'stock_permit' => [
            'model'  => StockPermit::class,
            'yearly' => true,
            'series' => [
                ['key' => 'receipt', 'prefix' => 'SR'],
                ['key' => 'issue', 'prefix' => 'SI'],
                ['key' => 'transfer', 'prefix' => 'ST'],
            ],
        ],
        'stocktake' => [
            'model'  => Stocktake::class,
            'yearly' => true,
            'series' => [['key' => 'default', 'prefix' => 'STK']],
        ],
        'expense' => [
            'model'  => Expense::class,
            'yearly' => true,
            'series' => [['key' => 'default', 'prefix' => 'EXP']],
        ],
        'asset' => [
            'model'  => Asset::class,
            'yearly' => true,
            'series' => [['key' => 'default', 'prefix' => 'FA']],
        ],
        'pos_session' => [
            'model'  => PosSession::class,
            'yearly' => true,
            'series' => [['key' => 'default', 'prefix' => 'POS']],
        ],
        'fuel_shift' => [
            'model'  => FuelShift::class,
            'yearly' => true,
            'series' => [['key' => 'default', 'prefix' => 'FSH']],
        ],
        'fuel_sale' => [
            'model'  => FuelSale::class,
            'yearly' => true,
            'series' => [['key' => 'default', 'prefix' => 'FSL']],
        ],
        'fuel_maintenance_work_order' => [
            'model'  => FuelStationWorkOrder::class,
            'yearly' => true,
            'series' => [['key' => 'default', 'prefix' => 'FMWO']],
        ],
        'fuel_safety_inspection' => [
            'model'  => FuelStationSafetyInspection::class,
            'yearly' => true,
            'series' => [['key' => 'default', 'prefix' => 'FSIN']],
        ],
        'corporate_fuel_contract' => [
            'model'  => CorporateFuelContract::class,
            'yearly' => true,
            'series' => [['key' => 'default', 'prefix' => 'CFC']],
        ],
        'journal_entry' => [
            'model'  => JournalEntry::class,
            'yearly' => true,
            'series' => [['key' => 'default', 'prefix' => 'JE']],
        ],
        'manual_journal' => [
            'model'  => ManualJournal::class,
            'yearly' => true,
            'series' => [['key' => 'default', 'prefix' => 'MJE']],
        ],
        'payroll_run' => [
            'model'  => PayrollRun::class,
            'yearly' => true,
            'series' => [['key' => 'default', 'prefix' => 'PR']],
        ],
        'employee' => [
            'model'  => Employee::class,
            'yearly' => false,
            'series' => [['key' => 'default', 'prefix' => 'EMP']],
        ],
                'employee_custody' => [
            'model'  => EmployeeCustody::class,
            'yearly' => true,
            'series'  => [['key' => 'default', 'prefix' => 'CST']],
        ],
        'employee_custody_settlement' => [
            'model'  => EmployeeCustodySettlement::class,
            'yearly' => true,
            'series'  => [['key' => 'default', 'prefix' => 'CSTL']],
        ],

        'branch' => [
            'model'   => Branch::class,
            'yearly'  => false,
            'setting' => ['group' => 'numbering', 'key' => 'branch_prefix'],
            'series'  => [['key' => 'default', 'prefix' => null]],
        ],
        'warehouse' => [
            'model'   => Warehouse::class,
            'yearly'  => false,
            'setting' => ['group' => 'numbering', 'key' => 'warehouse_prefix'],
            'series'  => [['key' => 'default', 'prefix' => null]],
        ],
    ];

    /** كل أنواع المستندات تقبل الآن تنسيقاً مستقلاً لكل سلسلة. */
    public static function editableKeys(): array
    {
        return array_keys(self::ENTITIES);
    }

    /** السلسلة الوحيدة/الأولى المعتمدة للكيان؛ هي عقد التوافق لطلبات PUT القديمة. */
    public static function defaultSeriesKey(string $key): string
    {
        $entity = self::ENTITIES[$key] ?? null;
        if ($entity === null) {
            throw new \InvalidArgumentException('كيان الترقيم غير معروف.');
        }

        return $entity['series'][0]['key'];
    }

    /** الكيان متعدد السلاسل لا يقبل تخمين السلسلة عند التعديل. */
    public static function requiresExplicitSeriesKey(string $key): bool
    {
        return count(self::ENTITIES[$key]['series'] ?? []) > 1;
    }

    /** تحقق أن السلسلة المطلوبة تخص الكيان نفسه، لا أنها مجرد مفتاح صحيح شكلياً. */
    public static function hasSeries(string $key, string $seriesKey): bool
    {
        return isset(self::ENTITIES[$key])
            && collect(self::ENTITIES[$key]['series'])->contains('key', $seriesKey);
    }

    /**
     * أصناف النماذج المرقَّمة **بالفرع** — أي ما يحمل رقماً قد يتكرّر بين فرعين.
     *
     * يُشتقّ من التصنيف نفسه لا من قائمة مكتوبة، فيبقى مطابقاً للواقع متى
     * تغيّر تصنيف نموذج. يستعمله حارس حذف الفرع لتحديد ما يمنع الحذف.
     *
     * @return array<int, class-string>
     */
    public static function branchNumberedModels(): array
    {
        return array_values(array_filter(
            array_map(fn (array $entity) => $entity['model'], self::ENTITIES),
            fn (string $model) => self::scopeOf($model) === 'branch'
        ));
    }

    /** وصف كيان واحد كاملاً: نطاقه وسلاسله وأرقامها التالية. */
    public static function describe(string $key): array
    {
        $entity = self::ENTITIES[$key];
        $model  = $entity['model'];
        $date = $entity['yearly'] ? now()->toDateString() : null;
        // يبقى حقل prefix متوافقاً مع عميل PUT القديم للكيان ذي السلسلة الواحدة؛
        // أما متعدد السلاسل فيظل مصدره الموثوق مصفوفة series.
        $prefix = count($entity['series']) === 1
            ? self::seriesFormat($key, self::defaultSeriesKey($key))['prefix']
            : self::effectivePrefix($key);

        return [
            'key'             => $key,
            'scope'           => self::scopeOf($model),
            'resets_yearly'   => $entity['yearly'],
            'format'          => self::FORMAT,
            'padding'         => self::PADDING,
            'editable_prefix' => true,
            'prefix'          => $prefix,
            'series'          => array_map(function (array $series) use ($key, $model, $date) {
                $format = self::seriesFormat($key, $series['key']);

                return [
                    'key'         => $series['key'],
                    'prefix'      => $format['prefix'],
                    'suffix'      => $format['suffix'],
                    // تمرير بادئة السلسلة الأساسية فقط؛ المولد يطبق الصيغة المحفوظة.
                    'next_number' => $model::nextDocumentNumber(self::defaultPrefix($key, $series), $date),
                ];
            }, $entity['series']),
        ];
    }

    /**
     * معاينة الرقم التالي لكي يظهر في نموذج الإنشاء من دون حجزه أو نسخ قواعد التوليد.
     *
     * @return array{key:string,series_key:string,number:string}
     */
    public static function preview(string $key, ?string $seriesKey = null, ?string $date = null): array
    {
        if (! array_key_exists($key, self::ENTITIES)) {
            throw new \InvalidArgumentException('كيان الترقيم غير معروف.');
        }

        $entity = self::ENTITIES[$key];
        $seriesKey ??= self::defaultSeriesKey($key);
        $series = collect($entity['series'])->firstWhere('key', $seriesKey);

        if ($series === null) {
            throw new \InvalidArgumentException('سلسلة الترقيم غير صالحة لهذا الكيان.');
        }

        $prefix = isset($entity['setting']) ? self::effectivePrefix($key) : $series['prefix'];
        $number = $entity['model']::nextDocumentNumber(
            $prefix,
            $entity['yearly'] ? ($date ?? now()->toDateString()) : null,
        );

        return ['key' => $key, 'series_key' => $seriesKey, 'number' => $number];
    }

    /**
     * صيغة سلسلة محددة؛ حذف الإعداد يعيد البادئة الأصلية ولا يكتب تنسيقاً موازياً.
     *
     * @return array{prefix:?string,suffix:string}
     */
    public static function seriesFormat(string $key, string $seriesKey): array
    {
        $entity = self::ENTITIES[$key] ?? null;
        $series = $entity ? collect($entity['series'])->firstWhere('key', $seriesKey) : null;
        if ($entity === null || $series === null) {
            throw new \InvalidArgumentException('سلسلة الترقيم غير صالحة.');
        }

        $stored = Settings::get('numbering', 'document_series');
        $custom = is_array($stored) ? ($stored[$key][$seriesKey] ?? []) : [];
        $fallback = self::defaultPrefix($key, $series);

        return [
            'prefix' => array_key_exists('prefix', $custom) && (string) $custom['prefix'] !== '' ? (string) $custom['prefix'] : $fallback,
            'suffix' => (string) ($custom['suffix'] ?? ''),
        ];
    }

    /** الصيغة الفعالة التي يستدعيها مولد النموذج من أي خدمة قائمة. */
    public static function formatForModel(string $model, ?string $fallbackPrefix): array
    {
        foreach (self::ENTITIES as $key => $entity) {
            if ($entity['model'] !== $model) {
                continue;
            }

            $series = collect($entity['series'])->first(fn (array $item) => self::defaultPrefix($key, $item) === $fallbackPrefix)
                ?? $entity['series'][0];

            return self::seriesFormat($key, $series['key']);
        }

        return ['prefix' => $fallbackPrefix, 'suffix' => ''];
    }

    /** حفظ تنسيق سلسلة واحدة فقط من دون لمس السلاسل أو الإعدادات الأخرى. */
    public static function putSeriesFormat(string $key, string $seriesKey, ?string $prefix, ?string $suffix): array
    {
        self::seriesFormat($key, $seriesKey); // تحقق من النوع والسلسلة أولاً.
        $all = Settings::get('numbering', 'document_series');
        $all = is_array($all) ? $all : [];
        $all[$key][$seriesKey] = [
            'prefix' => trim((string) $prefix, '-'),
            'suffix' => trim((string) $suffix, '-'),
        ];
        Settings::put('numbering', ['document_series' => $all]);

        return self::seriesFormat($key, $seriesKey);
    }

    /** البادئة الأصلية التي ترسلها الخدمات الحالية إلى مولد الأرقام. */
    private static function defaultPrefix(string $key, array $series): ?string
    {
        return isset(self::ENTITIES[$key]['setting']) ? self::effectivePrefix($key) : $series['prefix'];
    }

    /** كل الكيانات موصوفةً — حمولة الشاشة. */
    public static function describeAll(): array
    {
        return array_values(array_map(
            fn (string $key) => self::describe($key),
            array_keys(self::ENTITIES)
        ));
    }

    /**
     * نطاق التسلسل كما **تقرّره الطبقة نفسها** لا كما نستنتجه هنا.
     *
     * القاعدة معرَّفة في `GeneratesDocumentNumbers::isBranchNumbered()` وهي
     * `protected`. تُستدعى بالانعكاس بدل إعادة كتابتها: نسخةٌ ثانية من القاعدة
     * تفترق عن الأصل بصمت يوم يتغيّر التصنيف، فتعرض الشاشةُ نطاقاً غير الذي
     * يُرقَّم به فعلاً — وهو أسوأ من ألّا تعرضه.
     */
    private static function scopeOf(string $model): string
    {
        $method = new \ReflectionMethod($model, 'isBranchNumbered');
        $method->setAccessible(true);

        return $method->invoke(null) ? 'branch' : 'company';
    }

    /** البادئة السارية: المضبوطة إن وُجدت وإلا الثابت المعلن في الخدمة. */
    public static function effectivePrefix(string $key): ?string
    {
        $entity   = self::ENTITIES[$key];
        $fallback = $entity['series'][0]['prefix'];

        if (! isset($entity['setting'])) {
            return $fallback;
        }

        $stored = (string) Settings::get($entity['setting']['group'], $entity['setting']['key']);

        return $stored !== '' ? $stored : $fallback;
    }

    /**
     * كتابة بادئة كيانٍ مضبوط في موضعها الذي تقرؤه خدمتُه — لا مخزن مواز.
     *
     * المسح يُكتب نصاً فارغاً لا `null`: فـ`Settings::put` تُسقط `null` بمعنى
     * «لا تغيّر هذا المفتاح»، فإرسالها كان يُبقي البادئة القديمة صامتاً. والفراغ
     * قيمةٌ صريحة تعني «عُد إلى الافتراض» — و`effectivePrefix` تترجمها كذلك.
     */
    public static function putPrefix(string $key, ?string $prefix): string
    {
        $setting = self::ENTITIES[$key]['setting'];

        Settings::put($setting['group'], [$setting['key'] => (string) $prefix]);

        return self::effectivePrefix($key);
    }
}
