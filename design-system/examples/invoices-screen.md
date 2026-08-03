# مثال مرجعي: شاشة الفواتير (Invoices List Screen)

توثيق كامل لشاشة قائمة موجودة فعلاً، مربوطة ببنود Design System v2.0. **مثال حيّ**
يُحتذى لأي شاشة قائمة جديدة.

- **المصدر (As-Is):** `web/src/app/(app)/invoices/page.tsx`
- **النمط:** «شاشة قائمة» (List Screen) — `patterns/ux-patterns.md` §1.
- **الحالة:** موثّق كما هو؛ الانحرافات مرصودة في القسم الأخير (بلا تعديل كود).

---

## 1. التشريح (Anatomy)

```
<div space-y-4>                                  ← حاوية الشاشة (إيقاع رأسي)
├── <div flex items-center justify-between>      ← رأس الشاشة
│   ├── <h1 text-xl font-semibold text-text>     ← عنوان الصفحة: «الفواتير»
│   └── <Link/> <Button> [+ أيقونة] إنشاء فاتورة ← الإجراء الأساسي
└── <DataTable>                                  ← الجدول (البطل)
    ├── بحث · فرز · تصدير CSV
    ├── loading → Skeleton
    ├── empty → emptyLabel
    └── الأعمدة الستة (أدناه)
```

مطابق لقشرة «شاشة القائمة» في `layout/grid-system.md` (§Content Grid: «عمود واحد كامل»)
و`patterns/ux-patterns.md` (§1).

## 2. رموز التصميم المستخدمة (Token Mapping)

| العنصر | الصنف | الرمز/القاعدة |
|---|---|---|
| إيقاع الصفحة | `space-y-4` | `spacing/spacing-scale.md` (بين الأقسام) |
| عنوان الصفحة | `text-xl font-semibold text-text` | `typography/typography-scale.md` (عنوان صفحة) |
| زر الإنشاء | `<Button>` (primary افتراضي) | `components/buttons.md` |
| أيقونة الزر | `Plus h-4 w-4 strokeWidth={1.8}` | `tokens` (lucide، سماكة 1.6–1.8) |
| رابط رقم الفاتورة | `num text-primary hover:underline` | `colors/color-system.md` (تفاعل = primary) + `financial` (.num) |
| التاريخ | `num text-muted` | `financial/financial-ui.md` (أكواد/أرقام = .num) |
| الإجمالي | `num text-end` + `formatRiyal` | `financial/financial-ui.md` (محاذاة يمين، تنسيق ريال) |
| شارات الحالة | `<Badge tone=…>` | `components/data-display.md` (Badge) |

كل الألوان عبر الرموز — **لا hex خام** (يجتاز قاعدة `guidelines/engineering.md` §Tailwind).

## 3. مواصفة الأعمدة (Column Spec) — مطابقة DataTable

| # | العمود | المفتاح | الخلية | قاعدة DS |
|---|---|---|---|---|
| 1 | الرقم | `number` | رابط `num text-primary` لـ `/invoices/{id}` | `data-display.md`: «أول عمود رابط للتفاصيل» |
| 2 | العميل | `partner` (accessorFn) | اسم من خريطة `partners` أو «—» | نمط ربط المعرّف بالاسم |
| 3 | التاريخ | `invoice_date` | `num text-muted` | أرقام = `.num` |
| 4 | الإجمالي | `total` | `num text-end` + `formatRiyal` | `financial-ui.md` (يمين + ريال) |
| 5 | الحالة | `status` | `Badge` (positive/muted/negative) | `financial-ui.md` §4 (حالة = Badge + لون + نص) |
| 6 | السداد | `payment_status` | `Badge` (positive/warning/muted) | نفس القاعدة |

**خريطة نغمات الشارة (مطابقة للدلالة المالية):**
- `status`: `posted → positive` · `draft → muted` · `cancelled → negative`.
- `payment_status`: `paid → positive` · `partial → warning` · `unpaid → muted`.

مطابق تماماً لجدول نغمات Badge في `components/data-display.md` وللدلالة في `financial/financial-ui.md`.

## 4. الحالات (States) — `patterns/states.md`

| الحالة | التنفيذ في الشاشة | مطابقة |
|---|---|---|
| **Loading** | `loading` → `DataTable` يعرض Skeleton | ✅ §1 |
| **Empty** | `emptyLabel` يظهر عند لا صفوف | ✅ §2 (انظر ملاحظة i18n في §8) |
| **Error** | — | ⚠️ غير مُنفَّذ (انظر §8) |

## 5. تدفّق البيانات (Data Flow)

- جلب متوازٍ: `Promise.all([/invoices, /partners])` → يبني خريطة `partner_id → name`
  لعرض الاسم بدل المعرّف (تفادي نداء لكل صف).
- `useCallback(load)` + `useEffect` — نمط تحميل موحّد.
- المبالغ تصل من الـ API **بالريال نصّاً** وتُنسَّق بـ `formatRiyal` في العرض
  (طبقة العرض فقط — `financial/financial-ui.md` §1).

## 6. RTL والاستجابة

- خصائص منطقية فقط: `justify-between` (يعمل في الاتجاهين)، `text-end`، `text-start` (ضمنياً في TH).
  لا `left/right` — يجتاز `guidelines/engineering.md`.
- الاستجابة يوفّرها `DataTable` نفسه: جدول `md:block` ↔ بطاقات `md:hidden`
  (`layout/responsive.md` §1) — الشاشة لا تحتاج كوداً إضافياً.

## 7. i18n

- المفاتيح من `useTranslations('invoices')` و`('status')` — `title, number, partner, date,
  total, status, payment_status, search, create`.
- الحالات تُترجَم عبر مجموعة `status`.

## 8. رصد المطابقة (Compliance Findings) — توثيق فقط، بلا تعديل كود

الشاشة **تجتاز** معظم قواعد DS. رُصدت ثلاثة انحرافات (هذا بالضبط دور DS كأداة مراجعة):

| # | الانحراف | القاعدة | الشدّة | التوصية (لا تُطبَّق هنا) |
|---|---|---|---|---|
| A | `emptyLabel="لا توجد فواتير"` **نصّ عربي مكتوب مباشرة** لا مفتاح i18n | `guidelines/engineering.md` §7 «لا نصّ مكتوب؛ مفاتيح next-intl» | متوسّطة | استبدله بـ `t('empty')` وأضف المفتاح لـ ar/en |
| B | **لا حالة خطأ صريحة** — `Promise.all` بلا `.catch`؛ فشل الجلب يظهر كحالة «فارغة» | `patterns/states.md` §3 | متوسّطة | أضف `.catch` + رسالة خطأ/إعادة محاولة (تمييزها عن الفارغ) |
| C | الرأس `flex items-center justify-between` بدل `flex flex-wrap items-center gap-3` + `ms-auto` | `layout/grid-system.md` §Layout Rules 2 | منخفضة | استخدم `flex-wrap` لعنوان طويل على شاشة ضيقة |

> ملاحظة: `space-y-4` (بدل `space-y-5` في الوصفة القياسية) **ضمن المقياس ومقبول** — ليس انحرافاً.

## 9. الخلاصة (اختبار DS)

- **وثّقتُ الشاشة بالكامل من قواعد DS دون الحاجة لأي سؤال** → النظام مكتمل عند هذه الشاشة.
- DS أثبت قيمته المزدوجة: **مرجع بناء** (كل عنصر له قاعدة واضحة) و**أداة مراجعة**
  (كشف ٣ انحرافات محدّدة بدقّة).
- هذه الشاشة صالحة كـ **قالب «شاشة قائمة»** بعد معالجة الانحرافات الثلاثة (خارج نطاق هذا التوثيق).

## مرجع سريع للنسخ (Canonical List Screen)

انظر `examples/recipes.md` §«وصفة 1 — شاشة قائمة» — النسخة المثالية المطابقة 100% (تعالج
A/B/C مسبقاً: `emptyLabel={t('empty')}`، `flex-wrap … ms-auto`، ومعالجة الخطأ).
