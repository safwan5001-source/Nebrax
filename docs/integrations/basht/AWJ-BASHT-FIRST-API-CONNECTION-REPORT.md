# AWJ × BASHT — أول ربط API (تقرير + دليل تنفيذ)

**الفرع:** `claude/awj-basht-api-connection-cuabmx` · **Base SHA:** `ac8798eaf4d69144796a9f21b239fefc0bfd1af6` (main بعد دمج #2026)
**الحالة: الفحص مكتمل · التجهيز مكتمل · الاتصال الفعلي لم يُنفَّذ ولم يُختبر.**
لا يوجد ادعاء نجاح اتصال: لم يُصدَر مفتاح، ولم تُعدَّل خدمة باشت، ولم تُشغَّل أي استدعاءات مصادَقة.

## 1) نتائج الفحص (قراءة فقط)

| البند | النتيجة | الدليل |
|---|---|---|
| Public API على الإنتاج | **متاحة** | `GET https://nibras-api-production.up.railway.app/api/v1/health` ⇒ 200 `awj-public-api v1` |
| المسارات المطلوبة | **منشورة** وتطلب مصادقة | `products` و`partners` و`partners/{id}/statement` ⇒ 401 `unauthenticated` (وليس 404) |
| آخر نشر لـ `nibras-api` | SUCCESS، فرع `main`، 2026-11-05 19:09Z | Railway: `nibras-api` في مشروع «أَوْج AWJ» |
| طريقة إصدار المفاتيح | CLI فقط: `php artisan public-api:create-client <tenant> <name> --scopes=… --expires-days=…` أو واجهة المطوّر في الإعدادات | `PublicApiCreateClientCommand`؛ النص الصريح يُعرض **مرة واحدة** |
| Scopes المتاحة | `partners:read/write` · `products:read/write` · `invoices:read/write` · `statements:read` · `webhooks:read/write` | `PublicApiScope` |
| باشت | خدمة **`OpenClaw`** في مشروع Railway **«sweet-courtesy»** (منفصل عن مشروع أَوْج)، آخر نشر SUCCESS، نطاق `openclaw-production-ac97.up.railway.app`، قرص `/data` | Railway `describe-service` |
| إعداد OpenClaw | مصدره `safwan5001-source/openclaw-railway-template` (ليس في مستودع أَوْج). متغيراته (أسماء فقط): `GH_TOKEN`، `OPENCLAW_GATEWAY_TOKEN`، `SETUP_PASSWORD`، `OPENCLAW_STATE_DIR`، `OPENCLAW_WORKSPACE_DIR`، `BROWSERBASE_API_KEY`… **لا متغير لأَوْج بعد** | Railway (لم تُقرأ القيم) |
| ملاحظة | مشروع «Safwan Smart Assistant» (`safwan-api`…) خدمة أخرى؛ لم يتأكد أنها ليست باشت — المعتمد هنا `OpenClaw` ويلزم تأكيد المالك | — |

**ما لم يُتحقَّق منه (حدود الوصول):** من هذه الجلسة لا أستطيع تنفيذ أوامر داخل حاويتي `nibras-api` أو `OpenClaw`، ولا قراءة `openclaw.json` أو مجلد `skills` على القرص. لذلك لم أُصدر مفتاحاً (يلزم تشغيل Artisan على قاعدة الإنتاج) ولم أركّب المهارة في باشت. وفق وثائق OpenClaw (تم تأكيدها من docs.openclaw.ai): المهارة مجلد فيه `SKILL.md`، والأسرار تُضبط في `skills.entries.<name>.env`، وتُحقن للمضيف فقط. **لم يُتحقَّق** من: قيود `exec`، وهل تورث عملية `curl` المتغيرات المحقونة، ودعم `web_fetch` لترويسة `Authorization`.

## 2) ما جُهِّز في هذا الفرع (وثائق فقط، بلا كود تطبيق)

- `docs/integrations/basht/skills/awj-erp/SKILL.md` — مهارة OpenClaw للقراءة فقط (`GET products` / `GET partners`)، تعتمد `AWJ_API_KEY` و`AWJ_API_BASE` ولا تحمل أي سر، وتمنع اختراع البيانات.
- هذا التقرير. لا تغيير في المحاسبة أو قاعدة البيانات أو الصلاحيات أو الواجهة.

## 3) خطوات التنفيذ (بالترتيب — تتطلب المالك)

### الخطوة A — إصدار مفتاح باشت (قراءة فقط)
قرار مطلوب منك: **أي مستأجر (tenant) يقرأ منه باشت؟** الاختبار الحقيقي يلزمه مستأجر فيه منتجات فعلية.

تشغيله على خدمة `nibras-api` (Railway ← أَوْج AWJ ← nibras-api ← Shell، يعمل من الآيفون):
```bash
php artisan public-api:create-client <tenant-slug-or-uuid> "BASHT (read-only)" \
  --scopes=partners:read,products:read --expires-days=30
```
- انسخ المفتاح فور ظهوره (لا يظهر مرة ثانية) إلى مخزن الأسرار مباشرة؛ لا تلصقه في دردشة أو تذكرة.
- لا تضف `statements:read` (يكشف أرصدة العملاء) ولا أي write الآن.
- الإلغاء/التدوير: من واجهة المطوّر في أَوْج أو بإصدار مفتاح جديد وحذف القديم.

### الخطوة B — إضافة الأسرار لخدمة OpenClaw
في Railway ← sweet-courtesy ← OpenClaw ← Variables أضف (**Sealed** إن أمكن):
- `AWJ_API_KEY` = المفتاح من الخطوة A
- `AWJ_API_BASE` = `https://nibras-api-production.up.railway.app/api/v1`

> تعديل متغيرات OpenClaw يعيد نشر الخدمة — لم أفعله لأن القيد يشترط موافقتك الصريحة. أخبرني «نفّذ» وأضيف المتغير غير السري `AWJ_API_BASE` فقط؛ المفتاح تضعه أنت (أنا لا أستلم قيمته).

### الخطوة C — تركيب المهارة
`/setup` في OpenClaw (محمي بـ `SETUP_PASSWORD`) ← **Console**:
```bash
mkdir -p "$OPENCLAW_WORKSPACE_DIR/skills/awj-erp"
# الصق محتوى SKILL.md من docs/integrations/basht/skills/awj-erp/SKILL.md
```
أو `openclaw skills install git:safwan5001-source/Nebrax@<ref>` إن دعمت المسار الفرعي (غير مؤكد — يُجرَّب). ثم تأكد أن المتغيرين ظاهران للمهارة (إن لم يرثهما `curl`، اضبطهما في `skills.entries.awj-erp.env` عبر Control UI ← Config).

### الخطوة D — اختبار القراءة (معيار النجاح)
أرسل لباشت: «ابحث عن المنتجات الموجودة في أَوْج وأعطني أول خمسة منتجات».
قبول النتيجة فقط إذا:
1. مطابقة الأسماء/الـSKU لخمسة منتجات تراها في أَوْج لنفس المستأجر.
2. سجل الطلبات في لوحة المطوّر (تدقيق Public API) يُظهر `GET /products` من مفتاح باشت.
3. اختبار سلبي: فتح الرابط بدون المفتاح ⇒ 401؛ ومحاولة `POST` ⇒ 403 (scope).

### الخطوة E — اختبار الكتابة (بعد موافقتك فقط)
أصدر مفتاحاً **منفصلاً أو مدوَّراً** بإضافة `products:write` ثم:
```bash
curl -sS -X POST "$AWJ_API_BASE/products" \
  -H "Authorization: Bearer $AWJ_API_KEY" -H "Idempotency-Key: basht-test-001" \
  -H "Content-Type: application/json" \
  -d '{"name":"BASHT TEST — احذف","sku":"BASHT-TEST-001","sale_price_minor":10000,"tax_rate":15}'
```
أعد **نفس** الطلب بنفس المفتاح: يجب أن يعيد نفس الاستجابة (replay) ويظهر المنتج **مرة واحدة** في `GET /products?search=BASHT-TEST-001`. المنتج لا يولّد مخزوناً ولا قيداً. الحذف يدوي من أَوْج (لا DELETE في Public API).

## 4) نتائج الاختبارات والـ CI
- لا تغيير في `app/` أو `routes/` أو `web/` أو الهجرات، فلا يلزم تشغيل `php artisan test` (آخر تشغيل كامل أخضر على #2026 وفق `AWJ-AI-API-FIRST-INTEGRATION-REPORT.md`).
- CI لهذا الفرع: يُرفق بعد فتح الـ PR.
- اختبارات الاتصال الحي (قراءة/كتابة): **غير منفَّذة** — محجوبة بالخطوة A–C.

## 5) المخاطر
1. **Gateway باشت عام الاتجاه** (تحذير README القالب): تأكد من `SETUP_PASSWORD` قوي و`OPENCLAW_GATEWAY_TOKEN`، فمن يتحكم بباشت يتحكم بالمفتاح.
2. **حقن الأسرار:** مفتاح القراءة يكشف كل المنتجات/العملاء في المستأجر (نطاق المستأجر لا الفرع). صلاحية 30 يوماً وتدوير.
3. **عدم تأكيد** وراثة المتغيرات لعملية `curl` وقيود `exec` في OpenClaw — يُحسم بالتجربة في الخطوة D.
4. موجّه بالنص (Prompt): احتمال أن يضع الوكيل المفتاح في ردّه؛ المهارة تمنعه لكنها ليست حاجزاً تقنياً.
5. حدود المعدّل: قراءة/كتابة لكل عميل API (429 عند التجاوز).
6. أي مفتاح يُلصق في دردشة يُعدّ مكشوفاً — يُلغى فوراً.

## 6) الخطوة التالية
قرارك الآن: (1) اسم/UUID المستأجر الذي يقرأ منه باشت، (2) تأكيد أن الخدمة المقصودة هي `OpenClaw` في «sweet-courtesy»، (3) هل أضيف `AWJ_API_BASE` إلى OpenClaw. بعد تنفيذك الخطوة A والمفتاح في `AWJ_API_KEY` أعود لأشغّل اختبار القراءة وأوثّق النتيجة.
