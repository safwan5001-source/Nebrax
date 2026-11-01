<?php

namespace App\Support;

/**
 * مجالات الاستيراد الدائم المسموحة لتشغيلة (`ImportJob::domain`).
 *
 * قائمة نصّية على مستوى التطبيق لا نوع enum في قاعدة البيانات — إضافة مجال
 * تغيير كود لا هجرة. `product_catalog` (PR-DUR-1/2)، `product_workbook`
 * (PR-DUR-3)، و`inventory_opening` (PR-DUR-4) مربوطة الآن بمعالجة فعلية في
 * `ImportJobService::applyNextChunk()`. **`inventory_opening` مسودة فقط
 * (Draft) — لا ترحيل** (`InventoryOpeningService::post()` مسارٌ منفصل تماماً
 * لم يُربط ولن يُربط بهذا المحرك).
 */
final class ImportJobDomain
{
    /**
     * بوابات كل مجال — **تطابق حرفياً** بوابات واجهة الإنشاء المباشرة لكيان المجال (IMP-H1-S1):
     * `view`/`manage` صلاحيتا RBAC، و`app` مفتاح القدرة في `ApplicationCatalog` (أو `null` إن لم تُبوَّب
     * الواجهة المباشرة بقدرة). مصدر واحد: كل مجال جديد **يجب** أن يعلن هنا بواباته قبل تسجيله في
     * `values()` — يحرس ذلك `ImportJobAuthorizationTest` (لا مجال بلا بوابات، فلا يرث مجالٌ صلاحيات المنتجات).
     *
     * @var array<string, array{view: string, manage: string, app: ?string}>
     */
    private const AUTHORIZATION = [
        self::PRODUCT_CATALOG => ['view' => 'products.view', 'manage' => 'products.manage', 'app' => null],
        self::PRODUCT_WORKBOOK => ['view' => 'products.view', 'manage' => 'products.manage', 'app' => null],
        // `inventory-openings/import/*` المباشرة محروسة بـ`inventory.core` (routes/api.php).
        self::INVENTORY_OPENING => ['view' => 'products.view', 'manage' => 'products.manage', 'app' => 'inventory.core'],
        // IMP-H3-S2: `POST/PUT partners` المباشرة محروسة بـ`partners.view/manage` بلا بوابة قدرة (routes/api.php)؛ لا نخترع أخرى هنا.
        self::PARTNER_MASTER => ['view' => 'partners.view', 'manage' => 'partners.manage', 'app' => null],
        // IMP-H4-S5: `product-categories`/`brands`/`unit-templates` المباشرة محروسة بـ`products.view/manage` بلا قدرة؛ عناصر قوائم السعر بـ`company.manage`
        // للكتابة و`invoices.view` للقراءة (routes/api.php) — لا نخترع بوابة أضعف ولا أقوى.
        self::PRODUCT_TAXONOMY => ['view' => 'products.view', 'manage' => 'products.manage', 'app' => null],
        self::PRICE_LIST_ITEMS => ['view' => 'invoices.view', 'manage' => 'company.manage', 'app' => null],
        self::UNIT_TEMPLATES => ['view' => 'products.view', 'manage' => 'products.manage', 'app' => null],
        // IMP-H7-S1b: `stocktakes/{id}/count` المباشرة محروسة بـ`products.manage` + `inventory.core` (routes/api.php) — البوابات نفسها لا أضعف.
        self::STOCKTAKE_COUNT => ['view' => 'products.view', 'manage' => 'products.manage', 'app' => 'inventory.core'],
        // IMP-H5-S2: `POST expenses` المباشرة محروسة بـ`expenses.manage` + `finance.operations` (القراءة `expenses.view`) — البوابات نفسها لا أضعف.
        self::EXPENSE_IMPORT => ['view' => 'expenses.view', 'manage' => 'expenses.manage', 'app' => 'finance.operations'],
        // IMP-H5-S4a: `POST purchases` المباشرة محروسة بـ`purchases.manage` + `purchases.cycle` (القراءة `purchases.view`) — البوابات نفسها لا أضعف؛ ويُفحص المستودع على الفاعل في الخدمة.
        self::PURCHASE_IMPORT => ['view' => 'purchases.view', 'manage' => 'purchases.manage', 'app' => 'purchases.cycle'],
        // IMP-H7-S3: `POST stock-permits` المباشرة محروسة بـ`products.manage` + `inventory.core` (القراءة `products.view`) — البوابات نفسها لا أضعف؛ ويُفحص مخزن الفاعل في الخدمة.
        self::STOCK_PERMIT_IMPORT => ['view' => 'products.view', 'manage' => 'products.manage', 'app' => 'inventory.core'],
        // IMP-PS-A1 (D-PS-02): صلاحيتان مستقلتان بلا منح ضمني. `app = null` عمداً: مفتاح التطبيق لم يُحسم (D-PS-08 مفتوح) فلا يُخترع مفتاحٌ ولا يُستعار؛ والطرف يُحلّ بـ`partners.view` في الخدمة.
        self::PARTNER_STATEMENT => ['view' => 'partner_statements.view', 'manage' => 'partner_statements.reconcile', 'app' => 'accounting.partner_statements'],
    ];

    /**
     * صلاحياتٌ **إضافية** يشترطها المجال على كل مستوى (عرض/إدارة) فوق صلاحيته الخاصة — لا تُضعف بوابة ولا تُغني عنها. كشف حساب الطرف يعرض هوية الطرف وبياناته في قراءة التشغيلة، فيلزمه
     * `partners.view` كي لا تكون قراءة التشغيلة (`GET /import-jobs`) باباً خلفياً إلى بيانات طرفٍ لا يراه المستخدم (IMP-PS-A1، Codex #1877 P1). تُفحص عند كل قراءة فيسري سحبها فوراً.
     *
     * @var array<string, list<string>>
     */
    private const ALSO_REQUIRES = [
        self::PARTNER_STATEMENT => ['partners.view'],
    ];

    public const PRODUCT_CATALOG = 'product_catalog';

    public const PRODUCT_WORKBOOK = 'product_workbook';

    public const INVENTORY_OPENING = 'inventory_opening';

    /** العملاء والموردون (IMP-H3-S2) — النوع (عميل/مورّد) خيارٌ من خيارات التشغيلة لا مجالٌ منفصل. */
    public const PARTNER_MASTER = 'partner_master';

    /** تصنيفات المنتجات وعلاماتها (IMP-H4-S5) — النوع (تصنيف/علامة) خيارٌ من خيارات التشغيلة. */
    public const PRODUCT_TAXONOMY = 'product_taxonomy';

    /** عناصر قائمة سعر واحدة (IMP-H4-S5) — القائمة خيارٌ مجمَّد للتشغيلة. */
    public const PRICE_LIST_ITEMS = 'price_list_items';

    /** قوالب الوحدات، إنشاء فقط ولا مسار ذكاء اصطناعي (IMP-H4-S5، D-08). */
    public const UNIT_TEMPLATES = 'unit_templates';

    /** أعداد ورقة جردٍ مفتوح (IMP-H7-S1b) — وحدته الورقة كلها ذرّياً؛ الجرد المستهدف خيارٌ مجمَّد، والترحيل فعلٌ منفصل لا يمرّ من هنا. */
    public const STOCKTAKE_COUNT = 'stocktake_count';

    /** مسودات مصروفات (IMP-H5-S2): صفٌّ = مسودة، بلا ترحيل ولا قيد؛ منع التكرار بحجز الهوية، وتكرارٌ مؤكَّد صريح فقط يُستثنى. */
    public const EXPENSE_IMPORT = 'expense_import';

    /** مسودات فواتير مشتريات (IMP-H5-S4a): وحدتها الفاتورة كلها (مجموعة صفوف بـ مورّد ‖ رقم فاتورته)، بلا ترحيل ولا قيد ولا حركة مخزون؛ منع التكرار بحجز الهوية. */
    public const PURCHASE_IMPORT = 'purchase_import';

    /** مسودة إذنٍ مخزني واحد من ملف (IMP-H7-S3): وحدتها الملف كله ذرّياً، بلا ترحيل ولا قيد ولا حركة مخزون، ولا مسار ذكاء اصطناعي (D-09). */
    public const STOCK_PERMIT_IMPORT = 'stock_permit_import';

    /** كشف حساب طرف (عميل/مورّد) مستورد من الطرف الآخر (IMP-PS-A1): وحدته الملف كله ذرّياً؛ **تجهيز مقارنة فقط** — لا قيد ولا مستند ولا رصيد ولا حركة مخزون ولا مسار ذكاء اصطناعي. */
    public const PARTNER_STATEMENT = 'partner_statement';

    /** @return list<string> */
    /**
     * مجالات لا تُنشأ لها تشغيلة إلا مربوطةً بمعاينتها: خياراتها الدلالية الإلزامية (النوع/التصنيف·العلامة/قائمة السعر) وسياساتها تُجمَّد من المعاينة،
     * أما التشغيلة غير المربوطة فتحمل `apply_options = null` وطلب التطبيق لا يقبل هذه المفاتيح — فتفشل وقت التطبيق (أو تُهمَل سياستها بصمت). لا مسار
     * قديم غير مربوط لها أصلاً، فالإلزام لا يكسر أحداً.
     *
     * @var list<string>
     */
    public const PREVIEW_BOUND_ONLY = [self::PARTNER_MASTER, self::PRODUCT_TAXONOMY, self::PRICE_LIST_ITEMS, self::UNIT_TEMPLATES, self::STOCKTAKE_COUNT, self::EXPENSE_IMPORT, self::PURCHASE_IMPORT, self::STOCK_PERMIT_IMPORT, self::PARTNER_STATEMENT];

    public static function values(): array
    {
        return [
            self::PRODUCT_CATALOG,
            self::PRODUCT_WORKBOOK,
            self::INVENTORY_OPENING,
            self::PARTNER_MASTER,
            self::PRODUCT_TAXONOMY,
            self::PRICE_LIST_ITEMS,
            self::UNIT_TEMPLATES,
            self::STOCKTAKE_COUNT,
            self::EXPENSE_IMPORT,
            self::PURCHASE_IMPORT,
            self::STOCK_PERMIT_IMPORT,
            self::PARTNER_STATEMENT,
        ];
    }

    /** @return list<string> صلاحيات إضافية يشترطها المجال على كل مستوى (قائمة فارغة لأغلب المجالات). */
    public static function alsoRequires(string $domain): array
    {
        return self::ALSO_REQUIRES[$domain] ?? [];
    }

    /**
     * @return array{view: string, manage: string, app: ?string}
     *
     * @throws \InvalidArgumentException لمجال غير معلن — فشلٌ مغلق لا بوابة افتراضية.
     */
    public static function authorization(string $domain): array
    {
        return self::AUTHORIZATION[$domain]
            ?? throw new \InvalidArgumentException("لا بوابات معلنة لمجال الاستيراد: {$domain}");
    }
}
