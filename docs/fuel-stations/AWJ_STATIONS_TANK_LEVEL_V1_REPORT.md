# AWJ Stations — Tank Level Visualization V1 — التقرير

**الحالة: `BLOCKED — DATA CONTRACT`** (لا عقد API مصرَّح يعيد منسوباً حالياً صالحاً للمقارنة بالسعة).
المسلَّم: مكوّن عرض نقي **غير موصول بأي شاشة** + منطق تقييم مختبَر + رسائل ar/en، بلا أي ادعاء ببيانات حية. قائمة الخزانات في «المنتجات والمضخات» **لم تتغير** (لا بصرياً ولا سلوكياً).

| | |
|---|---|
| Branch | `claude/jolly-rubin-suk9ka` |
| Base SHA | `0f59ccc5fa1b638043fcd7bb33d4a5f02dedbe31` (`origin/main`) |
| Head SHA / PR | يُذكران في وصف الـPR (التقرير جزء من الـcommit فلا يحمل SHA نفسه) |
| دمج / نشر | لم يتما ولن يتما من هذه المهمة |

---

## 1) الأساس ومصدر الحقيقة (Phase 1)

**الواجهة:** `web/src/modules/station-ops/products-screen.tsx:134-166` — بطاقة الخزان تعرض الاسم/الرمز، المنتج، **السعة الاسمية** `capacity_milliliters`، عدد الفوهات، الحالة، وتحتها `InlineNote` (`products.tankLevelNote`) تقول صراحةً إن المنسوب الحالي غير معروض بعد. لا شاشة تفاصيل خزان في التطبيق (لا مسار `tanks/[id]` تحت `fuel-ops`) ⇒ **لا تفاصيل لتعزيزها** وفق القيد «لا صفحة تفاصيل جديدة».

**المخطط الحالي في الويب:** `schemas.ts:56-65` `tankSchema` = `id, fuel_station_id, fuel_product_id, code, name, capacity_milliliters, minimum_level_milliliters?, status` — لا حقل منسوب.

**الخادم:**

| المصدر | ما يعيده | هل هو «منسوب حالي»؟ |
|---|---|---|
| `GET fuel-stations/tanks[/{id}]` (`FuelTankResource`) | سعات (`capacity`, `safe_capacity`, `minimum_level`, `dead_stock`, `opening_volume`)، تهيئة، حالة، معايرة | **لا** — لا منسوب ولا قراءة. `opening_volume_milliliters` قيمة تكوين افتتاحية ثابتة وليست منسوباً حالياً |
| `GET fuel-stations/readings` (`FuelReconciliationController::readings`) | **كل** `FuelTankReading` (نوع `physical|atg`، `measured_at`) مرتبة تنازلياً، مرشّح وحيد `fuel_tank_id` | قياس نقطي تاريخي، لا منسوب حالي (انظر §2) |
| `GET fuel-stations/shifts/{id}` → `tank_readings` | قراءات افتتاح/إغلاق **وردية واحدة** (جدول مختلف `FuelShiftTankReading`) | لا — نطاقها الوردية لا المحطة |
| `FuelOperationalLedger.book_balance_milliliters` / `StockMovement` | رصيد دفتري | **غير مكشوف بأي GET** |

**التصنيف المطلوب (قياس فعلي / رصيد دفتري / تقديري / لا بيانات):**
- قياس فعلي: يوجد فقط كـ«قراءة نقطية» (`physical`/`atg`) بلا ضمان حداثة.
- رصيد دفتري: موجود في الدفتر التشغيلي لكنه **غير مكشوف**، وهو علاقة (مخزن، منتج) لا (خزان): `FuelReconciliationService::assertSingleTankPerBook` (السطر ~307) يرفض أصلاً أكثر من خزان لكل دفتر في المطابقة ⇒ الرصيد الدفتري لا يُنسب لخزان بعينه عموماً.
- تقديري: لا مصدر.
- النتيجة: **لا بيانات منسوب حالي** على عقد قائم.

## 2) لماذا لا يصلح `GET fuel-stations/readings` لبطاقة القائمة (بالأدلة)

1. **غير محدود ومكلف:** `->get()` بلا `limit` ولا «الأحدث فقط»؛ البطاقات N ⇒ N طلباً (`fuel_tank_id` لكل خزان) أو طلب واحد بكل التاريخ، مع `with(['station','tank','recorder'])`.
2. **ليس «الحالي»:** قياس نقطي في `measured_at`؛ المبيعات والاستلامات بعده تغيّر المنسوب. لا نافذة «قديم» معرَّفة في الدومين (المطلوب: لا نخترع واحدة).
3. **مصدر مجتزأ ومتعارض:** قراءات الورديات تُخزَّن في `FuelShiftTankReading` ولا تظهر في هذا المسار؛ «أحدث قراءة» هنا قد تكون أقدم من إغلاق وردية أحدث ⇒ قد تعرض منسوباً أقدم/مختلفاً عن الأحدث فعلاً.
4. **تسريب شكلي:** الاستجابة تحمل `evidence` الحرّ وبيانات `recorder`؛ لا حاجة لها في بطاقة وتوسّع سطح الكشف.
5. **صلاحية:** المسار يقبل `fuel_stations.view` **أو** `fuel.reading.view`، بينما قالب البائع لا يتضمن `fuel.reading.view` (`FuelStaffTemplates::SUPERVISOR_EXTRA`) ⇒ نية الصلاحية الأدق (مشرف) تُتجاوز عملياً بـ`fuel_stations.view`. اعتماد البطاقة عليه يثبّت هذا السلوك دون قرار.
6. **المقام غير محسوم:** `capacity` أم `safe_capacity` أم `capacity − dead_stock`؟ والمنسوب «القابل للاستخدام» يتأثر بـ`dead_stock`. الواجهة تُسقط `safe/dead` اليوم.

حسب التعليمات: **لم أحسب المنسوب من إيصالات/مبيعات/دفتر، ولم أضف API أو مخططاً أو منطق رصيد**.

## 3) ما نُفِّذ (عرض فقط، غير موصول)

- `tank-level.ts` — تقييم نقي: عتبات `TANK_LEVEL_THRESHOLDS` (20/50، عرضية)، `evaluateTankLevel` ⇒ `ok | over_capacity | unavailable{missing_level|invalid_level|invalid_capacity|conflicting_unit}`.
  - التصنيف بمقارنة صحيحة (`level×100` مقابل `حد×capacity`)؛ 50% و20% تماماً = متابعة، 19.99 = منخفض، 50.01 = جيد.
  - `displayPercent`: لا يُظهر 20/50/100 إلا إن كانت القيمة كذلك فعلاً (19.99 ⇒ «19.99%» لا «20% — منخفض»).
  - لا تحويل وحدات (وحدة غير mL ⇒ تعارض)، لا قصّ لتجاوز السعة، لا 0%/100% افتراضية، أصل القيمة (`physical|atg|book|estimated`) لا يُعرض إلا إن صرّح به الخادم، والطابع الزمني يُعرض فقط إن وصل وصحّ.
- `tank-level-indicator.tsx` — `TankLevelIndicator` بحالات `loading | error | ready`: «55% — جيد» نصاً، شريط أفقي ثابت (`role="meter"` + `aria-valuetext` يحمل النسبة والحالة واللترات والأصل)، «المستوى غير متاح» مع سبب للقيم غير الصالحة، شذوذ تجاوز السعة بلا شريط. رموز دلالية فقط (`positive/warning/negative`)، خصائص منطقية فقط، **بلا transition/animation** (لا إيحاء بتحديث حي، وreduced-motion محسوم تلقائياً).
- الرسائل `stationOps.tankLevel.*` (ar/en متطابقان، يحرسه `messages.test.ts` + عائلات ديناميكية أضفتها).

**لا يُستورد من أي شاشة**؛ يحرس العزل اختبار (لا `api()`/`fetch`/`data`/`read-client`).

## 4) الملفات

| ملف | تغيير |
|---|---|
| `web/src/modules/station-ops/tank-level.ts` | جديد — المنطق |
| `web/src/modules/station-ops/tank-level-indicator.tsx` | جديد — العرض |
| `web/src/modules/station-ops/tank-level.test.ts` | جديد — 30 اختباراً |
| `web/src/modules/station-ops/tank-level-indicator.test.tsx` | جديد — مكوّن/ar/en/axe/رموز/حركة |
| `web/src/modules/station-ops/messages.test.ts` | +3 عائلات مفاتيح ديناميكية |
| `web/src/messages/ar.json`, `en.json` | +`stationOps.tankLevel` |
| `docs/fuel-stations/AWJ_STATIONS_TANK_LEVEL_V1_REPORT.md` | هذا التقرير |

لا تغيير في: backend، migrations، مخطط الـAPI، الصلاحيات، `products-screen.tsx`.

## 5) الاختبارات والتحقق

| الأمر | النتيجة |
|---|---|
| `npx vitest run src/modules/station-ops` | **35 ملفاً / 1215 اختباراً — ناجحة** (تشمل الحراس القائمة: `rtl-logical`، `fuel-ops-tokens`، `app-only`، `write-boundary`، `messages`) |
| تغطية الحدود المطلوبة | 0 · 19.99 · 20 · 50 · 50.01 · 100 · كسور · سعة 0/سالبة/NaN/null · منسوب null/undefined/سالب/NaN/Infinity/نص · تجاوز سعة · وحدة متعارضة · غياب الأصل/الطابع |
| `npx tsc --noEmit` | 55 خطأ **قبل وبعد** (قديمة في ملفات أخرى: pos/commerce/platform…)؛ **صفر** في الملفات الجديدة |
| ESLint | **غير مُهيّأ في المستودع** (`next lint` يطلب إعداداً تفاعلياً؛ لا `eslint.config`) — لم يُشغَّل، ولم أضف تهيئة |
| `next build` | لم يُشغَّل محلياً: الوحدة غير مستوردة من أي صفحة فلا تدخل رسم البناء؛ يشغّله Web CI |
| RBAC / عزل المستأجر / المحطة / الفرع | **لا تغيير**: لا طلبات جديدة ولا تعديل خادم ⇒ السلوك الحالي كما هو. لا يوجد ما يُختبر هنا لتسريب قيم منسوب لأن لا قيم تُجلب |
| تحقق بصري iPhone Safari فاتح/داكن | **لم يُنفَّذ** — لا شيء معروض في التطبيق ليُصوَّر، ولا Safari/iPhone في هذه البيئة. لا لقطات قبل/بعد، ولا ادعاء نجاح بصري |

**QA يدوي لاحق (بعد الربط):** iPhone Safari ← `/ar/fuel-stations/ops/products` فاتح ثم داكن: لا تمرير أفقي؛ الشريط ونصه داخل البطاقة؛ الشريط السفلي غير محجوب؛ تدوير الشاشة؛ تبديل `dir`؛ Dynamic Type أكبر؛ VoiceOver يقرأ «منسوب الخزان — الاسم، 55% — جيد، 18,700 من 34,000 لتر»؛ حالة بلا منسوب تُظهر «المستوى غير متاح» والسعة.

## 6) ما يلزم لفتح الحجب — عقد مقترح أدنى (بانتظار موافقة منفصلة)

**الخيار الموصى به (إضافي، متوافق رجعياً):** إضافة حقل واحد اختياري إلى `GET fuel-stations/tanks` و`/{id}`:

```json
"last_level": null | {
  "milliliters": 18700000,
  "kind": "physical" | "atg",
  "measured_at": "2026-11-06T08:30:00+03:00",
  "source": "tank_reading" | "shift_reading"
}
```

- يحسبه الخادم **باستعلام واحد لكل الصفحة** (لا N+1): أحدث `measured_at` عبر `FuelTankReading` و`FuelShiftTankReading` معاً مع قاعدة ترجيح موثّقة للتعادل؛ `null` حين لا قراءة. اسمه «آخر قياس» لا «المنسوب الحالي» (لا يدّعي ما بعد القياس).
- نفس نطاق المحطة/الفرع/المستأجر لمسار الخزانات (`restrictToAccessibleStations`)، بلا `evidence` ولا `recorder`.
- إن أراد المالك «رصيداً دفترياً حالياً» فهو عقد منفصل وأثقل: يتطلب حسم نسبة الرصيد إلى خزان (انظر `assertSingleTankPerBook`) وليس ضمن هذا الاقتراح.

**اختبارات الخادم المطلوبة:** عزل المستأجر؛ تقييد المحطة والفرع والمخزن؛ RBAC (بدون الصلاحية ⇒ لا الحقل أو 403 كما يقرر المالك)؛ `null` بلا قراءة؛ اختيار الأحدث عبر الجدولين وتعادل الطابع؛ عدد الاستعلامات ثابت لا يتناسب مع عدد الخزانات؛ عدم تسريب `evidence`/`recorder`.

## 7) قرارات مطلوبة من المالك قبل التنفيذ

1. **الدلالة:** «آخر قياس» (موصى به) أم رصيد دفتري؟ وهل يُعرض بعمر القياس؟
2. **المقام:** `capacity` أم `safe_capacity` أم `capacity − dead_stock`؟
3. **العتبات:** هل تبقى 20/50 عرضية فقط أم يُحترم `minimum_level_milliliters` المعرَّف في الدومين كحدّ «منخفض»؟ (وجوده يجعل 20% ثابتة تتعارض أحياناً مع إعداد المحطة.)
4. **القِدَم:** هل يُعرَّف عمر قياس يصير بعده «قديماً»؟ (لا أعرّفه أنا.)
5. **الصلاحية:** `fuel_stations.view` كما الخزانات أم `fuel.reading.view`؟

## 8) المخاطر والمتبقي

- **كود غير مستخدم** في الإنتاج حتى يُعتمد العقد (مقصود ومعزول ومختبَر).
- لم يُنفَّذ: ربط الشاشة، تعزيز تفاصيل الخزان (لا شاشة)، تحقق بصري على الأجهزة.
- لا إعدادات سياسة جديدة؛ العتبات ثابتة عرضية في `TANK_LEVEL_THRESHOLDS` (إن صارت سياسة مستأجر فهي قاعدة 6 ⇒ قرار المالك).
