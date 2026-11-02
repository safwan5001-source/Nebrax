# COPS-H2-3 — Implementation Report (واجهة تنفيذ الطلب للموظف)

| البند | القيمة |
|---|---|
| Slice | COPS-H2-3 — قسم «التنفيذ» في `/commerce/orders/[id]` + شارة ومرشّح التنفيذ في القائمة |
| Branch | `claude/cops-h2-3-fulfillment-ui` (مكدَّس على H2-2) |
| PR / Merge SHA | تُسجَّل مجمَّعةً في `AWJ_COPS_H2_HORIZON_CLOSURE_REPORT.md` |
| الحالة | Implemented · Tested · عند الدمج Merged · **Not deployed · Not activated** (البوابة `COMMERCE_ORDER_FULFILLMENT_ENABLED` مغلقة) |
| العقد | خطة H2-0 §2.3 و§2.10 (AR-1) و§4.1 و§5 + قرارات D-H2-07/08 |

## 0. الخلاصة

- **لا تغيير في الخادم.** واجهة فقط فوق عقد H2-1 (`fulfillment`, `fulfillment_actions`, `fulfillment_status`).
- **الإجراءات من عقد القراءة وحده** (`fulfillment_actions` + `commerce.orders.manage`)؛ لا استنتاج من الحالة. غيابها (بوابة مغلقة/صلاحية ناقصة) ⇒ عرض الحقائق المخزَّنة فقط (AR-3).
- الكتابات الوحيدة الجديدة معزولة في `fulfill-order.ts`: `POST …/fulfillment/{action}` و`PATCH …/fulfillment`، بـ`expected_version` إلزامي.
- **AR-1:** عند `delivery_failed` نصٌّ ثابتٌ يشرح الحالة، والإجراءان المتاحان فقط إعادة الإرسال و«عاد للمتجر»؛ لا زر إغلاق/إلغاء/استرداد/شطب (يحرسه اختبار مكوّن وPlaywright).
- وسم دائم: «تنفيذ تشغيلي — لا قيد ولا فاتورة ولا مخزون ولا تحصيل»؛ «سُلِّم» لا يعني التحصيل (D-H2-07).

## 1. الملفات (web/src/modules/commerce-workspace/orders/)

| الملف | التغيير |
|---|---|
| `contract.ts` | ثوابت/أنواع التنفيذ، `OrderFulfillment`، `FulfillmentActionItem`، `fulfillmentStatus` في حالة القائمة وURL/الاستعلام (قائمة بيضاء بما فيها `not_started`) |
| `fulfill-order.ts` (جديد) | الكتابتان + التحقق (سبب الفشل، رابط https، هاتف 0–9، ≤500) |
| `fulfillment-section.tsx` (جديد) | القسم: الحقائق، الإجراءات، حوارات الفشل والتفاصيل، قفل إرسال مكرر (`useRef`) وقفل الحالة القديمة بعد 409/404/شبكة |
| `order-detail.tsx` · `order-display.tsx` · `orders-list.tsx` | دمج القسم، `FulfillmentBadge` (جاهز للاستلام لـ`pickup`)، عمود ومرشّح وبطاقة جوال |
| `messages.ts` | ar/en |
| `orders-readonly.test.ts` | يُعدَّل عمداً: يسمح بكتابات `fulfill-order.ts` وحده |
| `web/e2e/commerce-orders-h2-3.spec.ts` | Playwright |

## 2. الاختبارات والنتائج

| الفحص | النتيجة |
|---|---|
| Vitest وحدة المكوّنات (`commerce-workspace/orders`) | ✅ 10 ملفات / 187 اختباراً (جديد: `fulfill-order.test.ts`، `fulfillment-section.test.tsx` 18، مرشّح/شارة القائمة، `contract.test.ts`) |
| ضابط سلبي | تعطيل `disabled = busy || stale` إلى `busy` يُفشل «409 يقفل كل الإجراءات» ثم أُعيد |
| Playwright (سطح مكتب 1440 + جوال 390) | ✅ 10/10 لكل مشروع: ar/en، RTL/LTR، داكن/فاتح، عدم تجاوز أفقي، نقرتان متزامنتان ⇒ POST واحد، 409 ⇒ تحديث وإزالة الإجراء القديم، نص AR-1 بلا أزرار إغلاق/إلغاء/استرداد، حوار الفشل، بلا صلاحية/عقد ⇒ لا إجراء |
| `npm run build` | ✅ |
| `tsc --noEmit` | لا أخطاء في `commerce-workspace/orders`؛ أخطاء ملفات اختبار سابقة في وحدات أخرى (`store-experience-builder`, `flowers-admin`) خارج النطاق |

## 3. لا أثر محاسبي أو مخزني

الواجهة لا تستدعي أي مسار مالي/مخزني؛ جدول القيود: **لا قيود جديدة** (لا عملية مالية في الشريحة).

## 4. المخاطر والمتبقي

| البند | المعالجة |
|---|---|
| قسم التنفيذ مطويّ افتراضياً على الجوال (أكورديون القسم الحالي) | سلوك الصفحة القائم؛ الإجراءات مرئية بعد الفتح |
| لا تحديث حي لقائمة الطلبات | H3 |
| إجراء من صف القائمة | غير مبني عمداً (الملخّص بلا عقد إجراءات) |

## 5. الخطوة التالية

H2-4 (كتلة التتبع العامة الإضافية) — تلقائياً بعد دمج H2-3. لا نشر ولا تفعيل.
