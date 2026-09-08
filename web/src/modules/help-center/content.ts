export type HelpLocale = 'ar' | 'en';

export type HelpArticleSlug =
  | 'first-steps'
  | 'switch-active-branch'
  | 'create-sales-invoice'
  | 'record-customer-payment'
  | 'record-purchase-invoice'
  | 'create-product'
  | 'run-stocktake'
  | 'manual-journal-entry'
  | 'period-locks'
  | 'pos-session-and-sale';

export type HelpCategoryKey =
  | 'gettingStarted'
  | 'sales'
  | 'purchases'
  | 'inventory'
  | 'accounting'
  | 'pos';

type LocalizedText = Record<HelpLocale, string>;

export interface HelpSection {
  title: LocalizedText;
  paragraphs?: LocalizedText[];
  steps?: LocalizedText[];
  note?: LocalizedText;
}

export interface HelpArticle {
  slug: HelpArticleSlug;
  category: HelpCategoryKey;
  title: LocalizedText;
  summary: LocalizedText;
  keywords: LocalizedText;
  minutes: number;
  action?: { href: string; label: LocalizedText };
  sections: HelpSection[];
}

export const HELP_CATEGORIES: { key: HelpCategoryKey; title: LocalizedText; description: LocalizedText }[] = [
  {
    key: 'gettingStarted',
    title: { ar: 'البدء واستخدام أَوْج', en: 'Getting started with AWJ' },
    description: { ar: 'التنقل، الفروع، والحساب الشخصي.', en: 'Navigation, branches, and your account.' },
  },
  {
    key: 'sales',
    title: { ar: 'المبيعات والعملاء', en: 'Sales and customers' },
    description: { ar: 'الفواتير والتحصيل ومتابعة العملاء.', en: 'Invoices, collections, and customers.' },
  },
  {
    key: 'purchases',
    title: { ar: 'المشتريات والموردون', en: 'Purchases and suppliers' },
    description: { ar: 'دورة الشراء وفواتير الموردين.', en: 'Purchasing cycle and supplier invoices.' },
  },
  {
    key: 'inventory',
    title: { ar: 'المنتجات والمخزون', en: 'Products and inventory' },
    description: { ar: 'المنتجات والمخازن والجرد.', en: 'Products, warehouses, and stocktaking.' },
  },
  {
    key: 'accounting',
    title: { ar: 'المحاسبة والرقابة', en: 'Accounting and controls' },
    description: { ar: 'القيود والفترات والضوابط المحاسبية.', en: 'Journals, periods, and accounting controls.' },
  },
  {
    key: 'pos',
    title: { ar: 'نقطة البيع', en: 'Point of sale' },
    description: { ar: 'الجلسات، البيع، والإغلاق.', en: 'Sessions, checkout, and closing.' },
  },
];

export const HELP_ARTICLES: HelpArticle[] = [
  {
    slug: 'first-steps',
    category: 'gettingStarted',
    title: { ar: 'خطواتك الأولى في أَوْج', en: 'Your first steps in AWJ' },
    summary: { ar: 'تعرف على مساحة العمل وطريقة الوصول إلى المهام اليومية.', en: 'Learn the workspace and how to reach daily tasks.' },
    keywords: { ar: 'بداية لوحة التحكم القائمة الشريط الجانبي', en: 'start dashboard menu sidebar navigation' },
    minutes: 3,
    action: { href: '/dashboard', label: { ar: 'فتح لوحة التحكم', en: 'Open dashboard' } },
    sections: [
      {
        title: { ar: 'مساحة العمل', en: 'The workspace' },
        paragraphs: [
          { ar: 'تبدأ من لوحة التحكم. استخدم الشريط الجانبي للوصول إلى المبيعات والمشتريات والمخزون والمحاسبة وبقية الوحدات المتاحة لحسابك.', en: 'Start from the dashboard. Use the sidebar to reach sales, purchases, inventory, accounting, and the other modules available to your account.' },
        ],
      },
      {
        title: { ar: 'إنجاز أول مهمة', en: 'Complete your first task' },
        steps: [
          { ar: 'افتح المجموعة المطلوبة من الشريط الجانبي.', en: 'Open the required group from the sidebar.' },
          { ar: 'اختر شاشة القائمة للمراجعة أو شاشة الإنشاء لإضافة سجل جديد.', en: 'Choose the list screen to review records or the create screen to add one.' },
          { ar: 'راجع الفرع النشط أعلى الشاشة قبل إدخال أي حركة.', en: 'Confirm the active branch at the top before entering a transaction.' },
        ],
        note: { ar: 'العناصر التي تراها تعتمد على صلاحيات حسابك والتطبيقات المفعلة للمنشأة.', en: 'Visible items depend on your account permissions and the applications enabled for the company.' },
      },
    ],
  },
  {
    slug: 'switch-active-branch',
    category: 'gettingStarted',
    title: { ar: 'تبديل الفرع النشط بأمان', en: 'Switch the active branch safely' },
    summary: { ar: 'غيّر نطاق العمل وتأكد من الفرع قبل تسجيل الحركات.', en: 'Change the working scope and confirm it before recording transactions.' },
    keywords: { ar: 'فرع فروع تبديل نطاق الشركة', en: 'branch branches switch scope company' },
    minutes: 2,
    action: { href: '/branches', label: { ar: 'إدارة الفروع', en: 'Manage branches' } },
    sections: [
      {
        title: { ar: 'التبديل السريع', en: 'Quick switch' },
        steps: [
          { ar: 'افتح قائمة المستخدم في الشريط العلوي.', en: 'Open the user menu in the top bar.' },
          { ar: 'اختر الفرع المطلوب من قائمة الفروع المتاحة لك.', en: 'Select the required branch from those available to you.' },
          { ar: 'تحقق من ظهور اسم الفرع الجديد قبل المتابعة.', en: 'Confirm that the new branch name appears before continuing.' },
        ],
        note: { ar: 'تبديل الفرع يغير نطاق البيانات التشغيلية. لا تعتمد على الصفحة المفتوحة سابقاً دون مراجعة اسم الفرع.', en: 'Switching branches changes the operational data scope. Do not rely on a previously open page without checking the branch name.' },
      },
    ],
  },
  {
    slug: 'create-sales-invoice',
    category: 'sales',
    title: { ar: 'إنشاء فاتورة مبيعات', en: 'Create a sales invoice' },
    summary: { ar: 'أدخل العميل والبنود والضريبة ثم راجع الإجماليات قبل الحفظ.', en: 'Enter the customer, lines, and tax, then review totals before saving.' },
    keywords: { ar: 'فاتورة بيع عميل ضريبة خصم بنود', en: 'sales invoice customer tax discount lines' },
    minutes: 4,
    action: { href: '/invoices/new', label: { ar: 'إنشاء فاتورة', en: 'Create invoice' } },
    sections: [
      {
        title: { ar: 'إدخال الفاتورة', en: 'Enter the invoice' },
        steps: [
          { ar: 'اختر العميل وتاريخ الفاتورة وشروط الاستحقاق.', en: 'Select the customer, invoice date, and payment terms.' },
          { ar: 'أضف المنتجات أو الخدمات وحدد الكمية والسعر والخصم عند الحاجة.', en: 'Add products or services, then set quantity, price, and any discount.' },
          { ar: 'راجع الضريبة والإجمالي والفرع قبل الحفظ.', en: 'Review tax, total, and branch before saving.' },
          { ar: 'احفظ المسودة، ثم رحّلها فقط بعد اكتمال المراجعة.', en: 'Save the draft, then post it only after the review is complete.' },
        ],
        note: { ar: 'الترحيل إجراء محاسبي. تحقق من العميل والبنود والضريبة قبل تنفيذه.', en: 'Posting is an accounting action. Verify the customer, lines, and tax before doing it.' },
      },
    ],
  },
  {
    slug: 'record-customer-payment',
    category: 'sales',
    title: { ar: 'تسجيل دفعة عميل', en: 'Record a customer payment' },
    summary: { ar: 'سجل التحصيل واربطه بالفاتورة والوجهة المالية الصحيحة.', en: 'Record a collection and link it to the correct invoice and financial destination.' },
    keywords: { ar: 'دفعة سداد تحصيل عميل فاتورة صندوق بنك', en: 'payment receipt collection customer invoice cash bank' },
    minutes: 3,
    action: { href: '/payments/new', label: { ar: 'تسجيل دفعة', en: 'Record payment' } },
    sections: [
      {
        title: { ar: 'بيانات التحصيل', en: 'Collection details' },
        steps: [
          { ar: 'اختر العميل والفاتورة التي تم تحصيلها.', en: 'Choose the customer and the invoice being collected.' },
          { ar: 'حدد المبلغ والتاريخ وطريقة الدفع والخزينة أو الحساب البنكي.', en: 'Set the amount, date, payment method, and cash or bank account.' },
          { ar: 'أضف المرجع عند وجود تحويل أو إيصال خارجي، ثم راجع البيانات واحفظ.', en: 'Add the reference for a transfer or external receipt, then review and save.' },
        ],
        note: { ar: 'تأكد أن وجهة المال تطابق التحصيل الفعلي حتى يبقى رصيد الحساب صحيحاً.', en: 'Make sure the money destination matches the actual collection so the account balance remains correct.' },
      },
    ],
  },
  {
    slug: 'record-purchase-invoice',
    category: 'purchases',
    title: { ar: 'تسجيل فاتورة مشتريات', en: 'Record a purchase invoice' },
    summary: { ar: 'أدخل فاتورة المورد مع البنود والتكاليف والمخزن الصحيح.', en: 'Enter a supplier invoice with the correct lines, costs, and warehouse.' },
    keywords: { ar: 'شراء مشتريات مورد فاتورة مخزن تكلفة', en: 'purchase supplier invoice warehouse cost' },
    minutes: 4,
    action: { href: '/purchases/new', label: { ar: 'إنشاء فاتورة شراء', en: 'Create purchase invoice' } },
    sections: [
      {
        title: { ar: 'قبل الحفظ', en: 'Before saving' },
        steps: [
          { ar: 'اختر المورد وأدخل رقم فاتورته وتاريخها.', en: 'Select the supplier and enter their invoice number and date.' },
          { ar: 'حدد المخزن ثم أضف البنود بالكميات والوحدات والتكلفة الصحيحة.', en: 'Select the warehouse, then add lines with the correct quantities, units, and cost.' },
          { ar: 'راجع الضرائب والخصومات والإجمالي قبل الحفظ.', en: 'Review taxes, discounts, and the total before saving.' },
        ],
        note: { ar: 'اختيار المخزن والوحدة يؤثر في حركة المخزون وتقييمه؛ راجعهما قبل الترحيل.', en: 'Warehouse and unit selection affect stock movement and valuation; verify both before posting.' },
      },
    ],
  },
  {
    slug: 'create-product',
    category: 'inventory',
    title: { ar: 'إضافة منتج جديد', en: 'Add a new product' },
    summary: { ar: 'أنشئ بطاقة منتج واضحة بوحدة ورمز وأسعار صحيحة.', en: 'Create a clear product record with the correct unit, code, and prices.' },
    keywords: { ar: 'منتج صنف باركود رمز وحدة سعر تكلفة', en: 'product item barcode sku unit price cost' },
    minutes: 4,
    action: { href: '/products/new', label: { ar: 'إضافة منتج', en: 'Add product' } },
    sections: [
      {
        title: { ar: 'البيانات الأساسية', en: 'Core details' },
        steps: [
          { ar: 'أدخل اسم المنتج والرمز والباركود إن وجد.', en: 'Enter the product name, SKU, and barcode if available.' },
          { ar: 'حدد التصنيف والوحدة الأساسية وإعداد تتبع المخزون.', en: 'Set the category, base unit, and inventory tracking option.' },
          { ar: 'أدخل سعر البيع والتكلفة وفق صلاحيتك، ثم راجع الضرائب.', en: 'Enter the sale price and cost according to your permission, then review taxes.' },
          { ar: 'احفظ المنتج واستخدم الأرصدة الافتتاحية عند إدخال مخزون سابق.', en: 'Save the product and use opening balances for pre-existing stock.' },
        ],
        note: { ar: 'لا تكرر الرمز أو الباركود لنفس المنتج بصيغ مختلفة.', en: 'Do not duplicate the SKU or barcode for the same product in different forms.' },
      },
    ],
  },
  {
    slug: 'run-stocktake',
    category: 'inventory',
    title: { ar: 'تنفيذ جرد مخزني', en: 'Run a stocktake' },
    summary: { ar: 'قارن الكمية الفعلية بالنظام واعتمد الفروقات بعد المراجعة.', en: 'Compare physical quantities with the system and approve differences after review.' },
    keywords: { ar: 'جرد مخزون فعلي فرق تسوية مستودع', en: 'stocktake inventory physical variance adjustment warehouse' },
    minutes: 4,
    action: { href: '/stocktaking/new', label: { ar: 'بدء جرد', en: 'Start stocktake' } },
    sections: [
      {
        title: { ar: 'دورة الجرد', en: 'Stocktake cycle' },
        steps: [
          { ar: 'اختر الفرع والمخزن المشمولين بالجرد.', en: 'Select the branch and warehouse included in the count.' },
          { ar: 'سجل الكمية الفعلية لكل صنف دون تعديل الرصيد النظامي مباشرة.', en: 'Record the physical quantity for each item without directly changing system stock.' },
          { ar: 'راجع الفروقات وأسبابها مع المسؤول.', en: 'Review variances and their reasons with the responsible person.' },
          { ar: 'اعتمد التسوية فقط بعد التأكد من اكتمال العد والمراجعة.', en: 'Approve the adjustment only after the count and review are complete.' },
        ],
        note: { ar: 'اعتماد الجرد ينشئ أثراً مخزنياً؛ لا تستخدمه لتصحيح خطأ دون توثيق السبب.', en: 'Approving a stocktake creates an inventory effect; do not use it to correct an error without documenting the reason.' },
      },
    ],
  },
  {
    slug: 'manual-journal-entry',
    category: 'accounting',
    title: { ar: 'إنشاء قيد يومية يدوي', en: 'Create a manual journal entry' },
    summary: { ar: 'سجل قيداً متوازناً مع تاريخ ومرجع ووصف واضح.', en: 'Record a balanced journal with a clear date, reference, and description.' },
    keywords: { ar: 'قيد يومية مدين دائن حسابات ترحيل', en: 'journal entry debit credit accounts posting' },
    minutes: 4,
    action: { href: '/journal-entries', label: { ar: 'فتح القيود اليومية', en: 'Open journal entries' } },
    sections: [
      {
        title: { ar: 'إعداد القيد', en: 'Prepare the journal' },
        steps: [
          { ar: 'حدد التاريخ والفرع والمرجع، واكتب وصفاً يشرح سبب القيد.', en: 'Set the date, branch, and reference, and write a description explaining the reason.' },
          { ar: 'أضف الحسابات وحدد المدين والدائن لكل سطر.', en: 'Add accounts and set the debit or credit amount on each line.' },
          { ar: 'تحقق أن مجموع المدين يساوي مجموع الدائن.', en: 'Verify that total debits equal total credits.' },
          { ar: 'أرفق المستند المرجعي عند الحاجة، ثم راجع قبل الترحيل.', en: 'Attach the supporting document when needed, then review before posting.' },
        ],
        note: { ar: 'لا تستخدم القيد اليدوي لتجاوز دورة تشغيلية متاحة مثل فاتورة أو دفعة.', en: 'Do not use a manual journal to bypass an available operational flow such as an invoice or payment.' },
      },
    ],
  },
  {
    slug: 'period-locks',
    category: 'accounting',
    title: { ar: 'استخدام أقفال الفترات', en: 'Use accounting period locks' },
    summary: { ar: 'امنع الترحيل أو التعديل في الفترات المقفلة وفق صلاحياتك.', en: 'Prevent posting or editing in locked periods according to your permissions.' },
    keywords: { ar: 'قفل فترة محاسبية إغلاق تاريخ صلاحية', en: 'period lock accounting close date permission' },
    minutes: 3,
    action: { href: '/accounting-settings/period-locks', label: { ar: 'فتح أقفال الفترات', en: 'Open period locks' } },
    sections: [
      {
        title: { ar: 'إنشاء القفل', en: 'Create the lock' },
        steps: [
          { ar: 'حدد نطاق القفل والتاريخ الذي يمنع العمل قبله أو خلاله.', en: 'Set the lock scope and the date before or within which work is blocked.' },
          { ar: 'راجع الفترات المفتوحة والحركات المعلقة قبل تفعيل القفل.', en: 'Review open periods and pending transactions before enabling the lock.' },
          { ar: 'وثق سبب القفل ثم احفظه بالصلاحية المخصصة.', en: 'Document the reason, then save using the dedicated permission.' },
        ],
        note: { ar: 'قفل الفترة إجراء رقابي مستقل. لا ترفعه مؤقتاً لمعالجة حركة دون موافقة المسؤول.', en: 'A period lock is an independent control. Do not lift it temporarily to process a transaction without approval.' },
      },
    ],
  },
  {
    slug: 'pos-session-and-sale',
    category: 'pos',
    title: { ar: 'فتح جلسة نقطة بيع وإتمام عملية', en: 'Open a POS session and complete a sale' },
    summary: { ar: 'ابدأ الجلسة، أضف المنتجات، حصّل المبلغ، ثم أغلق الجلسة بالمراجعة.', en: 'Start a session, add products, collect payment, and close with a review.' },
    keywords: { ar: 'نقطة البيع جلسة كاشير سلة دفع إغلاق', en: 'pos session cashier cart checkout close' },
    minutes: 5,
    action: { href: '/pos/start', label: { ar: 'بدء البيع', en: 'Start selling' } },
    sections: [
      {
        title: { ar: 'من الفتح إلى التحصيل', en: 'From opening to collection' },
        steps: [
          { ar: 'افتح جلسة بيع وحدد رصيد الافتتاح عند طلبه.', en: 'Open a selling session and enter the opening balance when requested.' },
          { ar: 'أضف المنتجات إلى السلة وراجع الكميات والأسعار والخصومات.', en: 'Add products to the cart and review quantities, prices, and discounts.' },
          { ar: 'اختر طريقة الدفع وسجل المبلغ المستلم ثم أكمل العملية مرة واحدة.', en: 'Choose the payment method, record the amount received, then complete the sale once.' },
          { ar: 'عند نهاية العمل، راجع ملخص الجلسة والفرق ثم نفذ الإغلاق والتسليم.', en: 'At the end of work, review the session summary and variance, then close and hand over.' },
        ],
        note: { ar: 'إذا انقطع الاتصال أثناء الدفع، تحقق من أحدث الفواتير قبل إعادة العملية لتجنب التكرار.', en: 'If the connection drops during payment, check the latest invoices before retrying to avoid duplication.' },
      },
    ],
  },
];

export function helpLocale(locale: string): HelpLocale {
  return locale.toLowerCase().startsWith('ar') ? 'ar' : 'en';
}

export function getHelpCategory(key: HelpCategoryKey) {
  return HELP_CATEGORIES.find((category) => category.key === key)!;
}

export function getHelpArticle(slug: string) {
  return HELP_ARTICLES.find((article) => article.slug === slug);
}

/** Arabic-friendly search: ignores tashkeel, tatweel, hamza forms, and punctuation. */
export function normalizeHelpSearch(value: string) {
  return value
    .toLocaleLowerCase()
    .normalize('NFKD')
    .replace(/[\u064B-\u065F\u0670ـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function searchHelpArticles(query: string, locale: HelpLocale, category?: HelpCategoryKey) {
  const tokens = normalizeHelpSearch(query).split(' ').filter(Boolean);

  return HELP_ARTICLES.filter((article) => {
    if (category && article.category !== category) return false;
    if (tokens.length === 0) return true;
    const searchable = normalizeHelpSearch([
      article.title[locale],
      article.summary[locale],
      article.keywords[locale],
      ...article.sections.flatMap((section) => [
        section.title[locale],
        ...(section.paragraphs ?? []).map((value) => value[locale]),
        ...(section.steps ?? []).map((value) => value[locale]),
      ]),
    ].join(' '));
    return tokens.every((token) => searchable.includes(token));
  });
}
