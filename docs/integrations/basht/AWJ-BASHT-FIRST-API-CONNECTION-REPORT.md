# AWJ × BASHT — تفعيل الـ API لشركة نبراس الطموح

**الفرع:** `claude/awj-basht-api-connection-cuabmx` · **PR:** #2027 · **Base SHA:** `ac8798eaf4d69144796a9f21b239fefc0bfd1af6` · **Head SHA:** يُذكر في رسالة التسليم (آخر commit في الفرع)
**الحالة: التجهيز مكتمل 100% · التشغيل الحي لم يُنفَّذ — محجوب بخطوتين منك من الآيفون (≈5 دقائق). لا نجاح اتصال مُدّعى.**

## 1) ما تحقق فعلاً (مُثبَت)
| البند | الدليل |
|---|---|
| Public API v1 حيّة على الإنتاج | `GET /api/v1/health` ⇒ 200؛ المسارات الستة تردّ 401 بلا مفتاح (منشورة) |
| باشت = `OpenClaw` في `sweet-courtesy` | Railway: خدمة live، آخر نشر SUCCESS، قرص `/data` |
| مهارة `awj-erp` تغطي العمليات السبع | `docs/integrations/basht/skills/awj-erp/SKILL.md` |
| سكربت قبول ذاتي (8 خطوات، قابل للإعادة بلا تكرار) | `scripts/awj-acceptance.mjs`؛ جُرِّب بمفتاح خاطئ ⇒ 8/8 فشل نظيف (401) بلا طباعة أسرار |
| `AWJ_API_BASE` على OpenClaw | **مُجهَّز (staged)** — لا نشر حتى تضغط Deploy في Railway |

## 2) ما تعذّر ولماذا
| المطلوب | السبب |
|---|---|
| تحديد Tenant UUID/slug لـ«نبراس الطموح» | لا وصول تنفيذي لقاعدة الإنتاج من الجلسة (وكيل Railway نفسه أكّد: لا shell ولا SQL، قراءة ملفات فقط) |
| إصدار مفتاح API | يتطلب هوية مالك المستأجر أو Artisan على الإنتاج؛ والمفتاح يظهر مرة واحدة ولا أريد استلامه أصلاً |
| تركيب المهارة وتشغيل الاختبار الحي | لا وصول لقرص/Console باشت |
| تعديل Railway المسبب لإعادة نشر | محظور بقيدك — لذلك أُجهّز المتغير فقط |

> لذلك لا توجد نتائج «قراءة/كتابة حيّة» في هذا التقرير. معيار النجاح النهائي لم يتحقق بعد.

## 3) الجزء المحجوب — أقصر تنفيذ من الآيفون

**لا حاجة لمعرفة Tenant UUID ولا لـ shell.** صفحة المطوّر في أَوْج تُصدر المفتاح للمستأجر المسجَّل دخوله، فتطابق الهوية مضمونة بالتصميم.

**الخطوة 1 — إصدار المفتاح (دقيقتان)**
1. سجّل الدخول إلى أَوْج بحساب **مالك شركة نبراس الطموح** ← تأكد من اسم المؤسسة ظاهراً في الواجهة.
2. المطوّر ← **المفاتيح** (`/developer/keys`) ← إنشاء عميل: الاسم `BASHT`، الصلاحية بالضبط:
   `partners:read` · `partners:write` · `products:read` · `products:write` · `invoices:read` · `invoices:write` · `statements:read`، الانتهاء **30 يوماً**.
3. انسخ المفتاح (يظهر مرة واحدة) — **لا تلصقه في أي محادثة**.

**الخطوة 2 — تخزينه في OpenClaw (دقيقتان)**
Railway ← `sweet-courtesy` ← `OpenClaw` ← Variables:
- ستجد `AWJ_API_BASE` جاهزاً في التغييرات المعلّقة.
- أضف `AWJ_API_KEY` = المفتاح، واجعله **Sealed**. ثم **Deploy** (يعيد تشغيل باشت مرة واحدة).

**الخطوة 3 — تركيب المهارة والسكربت (دقيقة، من `/setup` ← Console)**
```bash
D="$OPENCLAW_WORKSPACE_DIR"; R="https://api.github.com/repos/safwan5001-source/Nebrax/contents/docs/integrations/basht"; B="ref=claude/awj-basht-api-connection-cuabmx"
mkdir -p "$D/skills/awj-erp" "$D/scripts"
curl -fsSL -H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/vnd.github.raw" "$R/skills/awj-erp/SKILL.md?$B" -o "$D/skills/awj-erp/SKILL.md"
curl -fsSL -H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/vnd.github.raw" "$R/scripts/awj-acceptance.mjs?$B" -o "$D/scripts/awj-acceptance.mjs"
node "$D/scripts/awj-acceptance.mjs"
```
(إن رفض `GH_TOKEN` الوصول للمستودع: افتح الملفين على GitHub من الآيفون وألصقهما بـ `cat > file <<'EOF'`.)
إن لم يرث الـ Console المتغيرات: `openclaw config` ← Skills ← `awj-erp` ← env، أو شغّل السكربت بعد `export` مؤقت داخل الجلسة.

**المخرجات المتوقعة:** `8/8 passed`. السكربت: يقرأ 5 منتجات حقيقية، يبحث عن عميل، ينشئ منتج `BASHT-TEST-001` وعميل `BASHT TEST CUSTOMER` وفاتورة **مسودة** واحدة بمفاتيح Idempotency ثابتة، يعيد الطلب ويتأكد من عدم التكرار، ويستخرج كشف الحساب. أرسل لي المخرجات (لا تحتوي أسراراً) وسأوثّقها هنا.

**ثم اختبار باشت نفسه:** «ابحث عن المنتجات الموجودة في أَوْج وأعطني أول خمسة منتجات» وقارنها بشاشة المنتجات في أَوْج.

## 4) الخطوة 8 — لا قيد محاسبي من المسودة (دليلان)
1. **من الـ API:** كشف حساب العميل التجريبي بعد إنشاء الفاتورة المسودة يجب أن يكون `rows=0` و`closing=0` (السكربت يتحقق).
2. **من الواجهة:** في أَوْج افتح الفاتورة التجريبية ← الحالة «مسودة» وبلا قيد يومية مرتبط؛ ودفتر الأستاذ لا يحتوي حركة بمصدرها. (المسودة تمر عبر `InvoiceService::create` فقط بلا `LedgerService::post`، ومغطّى باختبار `PublicApiPartnerStatementTest`.)

**الأثر المحاسبي لكل عملية جديدة:** لا يوجد. المنتج والعميل والمسودة لا تُنتج أي قيد؛ لا ترحيل ولا سداد ولا تحصيل (لا endpoint لها في Public API أصلاً).

## 5) الملفات المتغيرة
- `docs/integrations/basht/skills/awj-erp/SKILL.md` (محدَّث: 7 عمليات)
- `docs/integrations/basht/scripts/awj-acceptance.mjs` (جديد)
- `docs/integrations/basht/AWJ-BASHT-FIRST-API-CONNECTION-REPORT.md` (هذا التقرير)
- لا تغيير في `app/` `routes/` `web/` قاعدة البيانات الصلاحيات المحاسبة.
- Railway: متغير `AWJ_API_BASE` مُجهَّز staged على OpenClaw، بلا نشر.

## 6) الاختبارات وBuild/CI
- `node --check` للسكربت ✅ · تشغيل بمفتاح خاطئ ⇒ فشل نظيف ✅.
- لا تغيير في كود التطبيق فلا حاجة لـ `php artisan test` (آخر حزمة كاملة خضراء على #2026).
- CI على #2027: ينتظر نتائج GitHub؛ مراجعة Codex فشلت بسبب نفاد حصتها لا لوجود ملاحظات.
- الاتصال الحي: **غير منفَّذ**.

## 7) المخاطر
1. المفتاح يحمل كتابة + `statements:read` (أرصدة العملاء) على كامل المستأجر وكل الفروع — لذا 30 يوماً؛ ألغِه من `/developer/keys` عند أي شك.
2. بوابة OpenClaw عامة الاتجاه: تأكد من قوة `SETUP_PASSWORD` و`OPENCLAW_GATEWAY_TOKEN`؛ من يتحكم بباشت يتحكم بالمفتاح.
3. منع الوكيل من كشف المفتاح قائم على تعليمات المهارة لا على حاجز تقني؛ وراثة المتغيرات لعملية `curl` وقيود `exec` غير مؤكدة في وثائق OpenClaw — يحسمها السكربت.
4. بيانات الاختبار (منتج/عميل/مسودة) تبقى في بيانات نبراس الحقيقية؛ تُحذف يدوياً بعد الفحص (لا DELETE في Public API).
5. حدود المعدّل للكتابة (429).

## 8) الخطوة التالية
نفّذ الخطوات 1–3 وأرسل مخرجات السكربت (`N/8 passed` والأسطر). أي فشل أعالجه فوراً؛ وعند النجاح أحدّث التقرير بالنتائج الحية وتُغلق المهمة.
