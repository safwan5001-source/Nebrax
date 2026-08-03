# Sidebar · Topbar · Command Palette (Navigation)

## Sidebar (`layout/sidebar.tsx`)

Anatomy: `fixed inset-y-0 start-0 z-50 flex w-64 flex-col border-e border-border bg-surface`.

- **العرض:** درج جوال `w-64` (256px)؛ ثابت على `lg+` بعرض أضيق `lg:w-56` (224px) — يوسّع مساحة
  المحتوى مع بقاء تسميات الأقسام العربية على سطر واحد (`transition-transform duration-200`).
- **مجمّع حسب خريطة الوحدات الثماني** (المبيعات، العملاء، المخزون، الحسابات، الموارد البشرية،
  التشغيل، اللوجستيات، النظام). كل مجموعة: عنوان خافت صغير + روابطها.
- **مجموعات قابلة للطيّ** (`ChevronDown`) مع **تذكّر الحالة عبر الجلسات** (`localStorage`:
  `nibras.sidebar.groups`)؛ المجموعة الحاوية للصفحة الحالية تُفتح تلقائياً دون تعديل التفضيل المحفوظ.
- **الرابط:** `flex h-9 items-center gap-2 rounded px-2 text-sm text-muted hover:bg-primary-soft hover:text-primary`
  + أيقونة Lucide `h-4`.
- **النشط:** `bg-primary-soft font-medium text-primary` + مؤشّر خطّ جانبي
  `absolute inset-y-1.5 start-0 w-0.5 bg-primary`.
- الوحدات غير المبنية: شارة **«قريباً»**.
- RTL أولاً (`start-0`, `border-e`). جوال: خلفية معتمة تُغلق الدرج.

### قواعد
1. الشريط يعكس **خريطة الوحدات حرفياً** (المصدر: `CLAUDE.md`).
2. عنصر نشط واحد (حسب `usePathname`).
3. لا تُضِف عناصر خارج الخريطة دون تحديثها.

## Topbar (`layout/topbar.tsx`)

`h-14 border-b border-border bg-surface px-4`, عناصر:
- زر `☰` (`lg:hidden`) لفتح درج الشريط.
- صندوق بحث (`sm:flex`).
- تحية باسم المستخدم (`sm:block`).
- `LangToggle` · `ThemeToggle` · زر خروج.

قاعدة: الرأس ثابت (لا يمرّر)، محايد، بلا ألوان — أدوات عامة فقط.

## Command Palette (⌘K) — مقترح v2.0 (غير مُنفَّذ)

لوحة أوامر عالمية على طراز Linear/Notion. **غير موجودة بعد** — مواصفة للتنفيذ:

- **الاستدعاء:** `Ctrl/⌘ + K` من أي مكان.
- **الشكل:** حوار متمركز أعلى الشاشة، حقل بحث + قائمة نتائج مجمّعة (تنقّل، إنشاء، بحث بيانات).
- **الفئات:** الانتقال لشاشة · إجراء سريع (فاتورة/عميل جديد) · بحث في السجلّات · تبديل الوضع/اللغة.
- **لوحة المفاتيح:** أسهم للتنقّل، Enter للتنفيذ، Esc للإغلاق، تحديد أول نتيجة تلقائياً.
- **الرموز:** يعيد استخدام Dialog + Input + قائمة عناصر بنمط الشريط النشط.
- **z-index:** `--z-command` (60) — فوق الحوار، تحت التنبيهات.
- **الوصولية:** `role="dialog"`, `aria-activedescendant`, `role="listbox"/"option"`.

> التبرير والأثر في `foundations/recommended-improvements.md`. حتى تُنفَّذ، التنقّل عبر الشريط والروابط.
