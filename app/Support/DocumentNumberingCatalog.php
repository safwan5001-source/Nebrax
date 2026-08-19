<?php

namespace App\Support;

use App\Models\Asset;
use App\Models\Branch;
use App\Models\CashBankTransfer;
use App\Models\CreditNote;
use App\Models\Employee;
use App\Models\EmployeeCustody;
use App\Models\EmployeeCustodySettlement;
use App\Models\Expense;
use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\Payment;
use App\Models\PayrollRun;
use App\Models\PosSession;
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
        'invoice' => [
            'model'   => Invoice::class,
            'yearly'  => true,
            'setting' => ['group' => 'sales', 'key' => 'invoice_prefix'],
            'series'  => [['key' => 'default', 'prefix' => 'INV']],
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
        'journal_entry' => [
            'model'  => JournalEntry::class,
            'yearly' => true,
            'series' => [['key' => 'default', 'prefix' => 'JE']],
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

    /** الكيانات التي تُحرَّر بادئتها من الشاشة — وهي وحدها ما تقرؤه الخدمات من الإعدادات. */
    public static function editableKeys(): array
    {
        return array_keys(array_filter(
            self::ENTITIES,
            fn (array $entity) => isset($entity['setting'])
        ));
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
        $date   = $entity['yearly'] ? now()->toDateString() : null;
        $prefix = self::effectivePrefix($key);

        return [
            'key'             => $key,
            'scope'           => self::scopeOf($model),
            'resets_yearly'   => $entity['yearly'],
            'format'          => self::FORMAT,
            'padding'         => self::PADDING,
            'editable_prefix' => isset($entity['setting']),
            'prefix'          => $prefix,
            'series'          => array_map(fn (array $series) => [
                'key' => $series['key'],
                // البادئة المضبوطة تُطبَّق على السلسلة الوحيدة للكيانات المضبوطة؛
                // ومتعدّدةُ السلاسل ثوابتُها في خدمتها فتُعرَض كما هي.
                'prefix' => isset($entity['setting']) ? $prefix : $series['prefix'],
                // الرقم التالي من الطبقة نفسها — لا حساب موازٍ.
                'next_number' => $model::nextDocumentNumber(
                    isset($entity['setting']) ? $prefix : $series['prefix'],
                    $date
                ),
            ], $entity['series']),
        ];
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
