# ما يتغيّر عن قواعد v2.0 (Rules Delta) — v3.0-draft

> قراءة سريعة لـ«ماذا أصبح مصير القاعدة القديمة؟». **لا تُعدّل القواعد النافذة اليوم إلا بتنفيذ الشريحة المقابلة** ([`MIGRATION.md`](./MIGRATION.md)).
> المصادر: [`DESIGN_SYSTEM.md`](../../DESIGN_SYSTEM.md)، [`design-system/`](../README.md)، وثائق V2 في `docs/plans/design/`.
> **Keep** تبقى · **Evolve** تبقى بنية وتتطوّر · **Replace** تُستبدل.

## 1. القواعد المطلقة الثمانية التي طلب المالك مراجعتها

| القاعدة | الحكم | القاعدة الجديدة (سياقية) | الأساس |
|---|---|---|---|
| **لون هوية واحد** | **Evolve** | عائلة هوية واحدة لكل Workspace (في Ledger: الأزرق وحده). ألوان **شارات الوحدات** (6) ليست هوية بل علامات تعريف لكائنات، **بلا ألوان الدلالة** | FOUNDATIONS §2، COMMERCE §4 |
| **شريط جانبي محايد** | **Evolve** | **قشرة بنغمة** عبر سمتين: Default (مصبوغ) وInk (حبري). تبقى هادئة للبيانات | THEMES |
| **ظلال دنيا** | **Evolve** | سلّم ارتفاع **5 مستويات**؛ الظل = ارتفاع فعلي فقط؛ المسطّح بلا ظل | FOUNDATIONS §9 |
| **لا تدرّجات** | **Keep (مشدَّدة) + استثناءات وظيفية** | ممنوعة على أسطح العمل. مسموح: scrim فوق صورة، هيكل تحميل، مناطق رسم | R-11 |
| **لا أيقونات في صناديق ملوّنة** | **Evolve** | محظورة في التنقّل وKPI والجداول. مسموحة كـ**Module Mark** (كائن) في كتالوج التطبيقات/القنوات/الثيمات/لوحة Builder | COMMERCE §4 |
| **أسطح مقيَّدة** | **Replace** | هرمية أسطح من 9 أدوار بفصل ≥ 1.2:1 | FOUNDATIONS §3 |
| **ارتفاع محدود** | **Evolve** | = سلّم الارتفاع | FOUNDATIONS §9 |
| **حالات مسطّحة (Flat status)** | **Evolve** | glyph + نص دائماً؛ الشارة الملوّنة لما **يتطلب فعلاً** | SIGNATURE §6 |
| **قشرة هادئة (Quiet shell)** | **Evolve** | «**محتوى هادئ، قشرة ذات طابع**» (السمة)؛ القشرة تحمل هوية بلا منافسة البيانات | THEMES |

## 2. بقية القواعد

| القاعدة (المصدر) | الحكم | v3 |
|---|---|---|
| الجداول هي البطل | **Keep** | + لغة شبكة جديدة |
| كثافة متوازنة | **Evolve** | تشريح صف + 3 درجات + طبقة ارتفاع قصير |
| حلقة التركيز `ring-primary/40` (README، standards) | **Replace** | عقد 2px/2px + عدم الحجب + `forced-colors` |
| `DESIGN_SYSTEM.md`: النماذج البصرية ليست مصدر لون | **Keep (روحاً)** | المصدر الوحيد = `awj.tokens.json`؛ الـPrototype غير معياري |
| لا hex خام | **Keep + فرض** | ratchet وفحوص |
| الأخضر/الأحمر دلاليان حصراً + إشارة | **Keep** | |
| `muted` ≥ 4.5:1 | **Keep** | + `text-tertiary` مقيَّد بالأسطح؛ `border.control` ≥ 3:1 جديد |
| خطّان فقط، أوزان ≤ 600 | **Keep** | + مقياس: أُضيف 13 و30؛ **الأدنى 12** |
| حدّ أدنى 11px (`caption`) | **Replace** | 12px |
| `CardTitle` هادئ (`text-sm font-medium text-muted`) | **Evolve** | عنوان قسم `type.section` 14/600 `text-primary` داخل مساحات المستند؛ تسمية KPI تبقى ثانوية |
| الزاوية 8px افتراضياً + استثناء لوحة التحكم 16px | **Evolve** | سلّم بالدور (6/8/12/16)؛ 16 = `radius.canvas` |
| بطاقات بلا ظل (فصل بالحدّ) | **Keep** للمسطّح | + `raised` للـCommand Bar/بطاقة المستند |
| hover الصف `primary-soft/40` | **Replace** | `state-hover` / `state-selected` |
| `primary-soft` متعدّد الأدوار (319) | **Evolve** | يتفرّع بالسياق؛ يبقى Alias |
| الأرقام: `.num`، محاذاة نهاية، فاصلتان، رمز بعد الرقم، لا حركة | **Keep** | + AWJ numerals (صحيح/كسور) |
| `formatRiyal`/`SAUDI_RIYAL_SYMBOL` | **Keep** | |
| الشريط الجانبي: مجمّع 248px، مؤشر نشط بخط جانبي + `primary-soft` | **Evolve** | قشرة بسمة + **Apex** |
| «شريط جانبي أيقوني» في «نمط الشاشة الموحّد» | **Replace (تصحيح انجراف)** | غير صحيح: التنقّل موسَّع بتسميات؛ icon rail غير معتمد |
| الاستجابة: جداول → بطاقات | **Evolve** | DataTable فقط؛ بنود المستند: قائمة سطور + محرّر |
| أهداف اللمس ≥ 40 (الجوال) | **Evolve** | 24 مطلق · 32/36/44 بالدرجة؛ `pointer: coarse` |
| Badge لحالة المستند (مسودة/مرحّلة/…) | **Evolve** | مسار حالة من محورين + glyph في القوائم |
| WCAG 2.1 AA | **Evolve** | 2.2 AA |
| الحركة: لا > 300ms؛ لا تحريك أرقام | **Keep** | + `instant/fast/base/slow`؛ `R-01` |
| اختصارات لوحة المفاتيح المقترحة | **Evolve** | قرارات: لا ترحيل بمفتاح واحد؛ `Alt+N` للبند؛ F2 للتحرير |
| `DataTable` «قدرات ناقصة» | **Replace (تصحيح انجراف)** | موجودة اليوم؛ والناقص الفعلي في [`DATA_GRID.md`](./DATA_GRID.md) §1 |
| `prefers-reduced-motion` «مقترح» | **Replace (تصحيح انجراف)** | منفَّذ |
| ألوان الدلالة `#16A34A/#DC2626/#D97706` | **Replace (تصحيح انجراف)** | قيم الكود `#166534/#B91C1C/#92400E` فاتحاً |
| «الرموز الدلالية ثابتة عبر الوضعين» | **Replace (تصحيح انجراف)** | تتبدّل في الداكن؛ تعريفها لكل وضع |
| المرجع الجمالي (Stripe/Linear/Vercel/GitHub/Notion) | **Keep** (ذوق) | لا نسخ؛ [`AWJ_V2_DESIGN_QUALITY_BAR.md`](../../docs/plans/design/AWJ_V2_DESIGN_QUALITY_BAR.md) نافذة |

## 3. وثائق V2 في `docs/plans/design/`

| الوثيقة | الحالة |
|---|---|
| `AWJ_V2_DESIGN_QUALITY_BAR.md` | **Keep** — بوابات المراجعة نافذة |
| `AWJ_DESIGN_SYSTEM_V2_BLUEPRINT.md` | **Keep** — البنية والأنماط؛ v3 تضيف اللغة البصرية |
| `AWJ_APP_SHELL_V2_*` | **Evolve** — «قشرة محايدة» تصبح Default/Ink؛ بقية القرارات (يمين RTL، لا icon rail، جوال بدرج، ارتفاع) تبقى |
| `AWJ_DOCUMENT_WORKSPACE_PATTERN_V2_SPEC.md` + `…VIEW_WORKSPACE…` + `…LIFECYCLE_RECONCILIATION.md` | **Keep + يُبنى فوقها** ([`DOCUMENT_WORKSPACE.md`](./DOCUMENT_WORKSPACE.md)) |
| `AWJ_MASTER_RECORD_PATTERN_V2_SPEC.md` وما يخصّ العملاء/الموردين/المنتجات | **Keep** — يرث لغة v3 دون تغيير بنية |
| `AWJ_SALES_INVOICE_V2_*` | **Keep (مرجع حالة)** — تُقرأ مع تصحيحات [`DECISIONS.md`](./DECISIONS.md) §4 |
| `AWJ_NAVIGATION_IA_*` | **Keep** — v3 لا تغيّر IA |
| `AWJ_ERP_UX_REFERENCE_RESEARCH.md` | **Keep** — بوابة Freshness |
