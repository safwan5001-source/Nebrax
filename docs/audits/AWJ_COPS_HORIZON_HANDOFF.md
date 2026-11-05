# COPS Horizon — Handoff (التسليم الحيّ)

**البرنامج:** AWJ Commerce Operations Horizon (COPS) — امتداد لـ `AWJ_STORE_COMMERCE_MASTER_HORIZON_V1` (المتتبّع §9).
**آخر تحديث:** 2026-11-05 — **COPS-H4 مكتمل ضمن التفويض (H4-0 … H4-7 كلها مدموجة؛ التقرير: `AWJ_COPS_H4_CLOSURE_REPORT.md`)؛ بوابة `COMMERCE_CHANNEL_INTAKE_CONTROLS_ENABLED` مغلقة والتوقف قبل تفعيلها.** سجل سابق: 2026-11-04 (مساءً) — اعتمد المالك قرارات H4 كاملة وفُوِّض تنفيذ H4-3..H4-7 ذاتياً. سجل سابق: 2026-11-04 — **COPS-H4-0 (تخطيط وقرارات) مُسلَّم؛ H4-1 مدموج وH4-2 قيد الدمج؛ التوقف عند أول بوابة قرار (`AWJ_COPS_H4_0_DECISION_AND_EXECUTION_PLAN.md`).** سجل سابق: 2026-11-03 — **COPS-H3 مكتمل ضمن التفويض (H3-1/3/4 مدموجة؛ `AWJ_COPS_H3_FINAL_REPORT.md`)؛ H3-5 بانتظار مرجع بصري.** سجل سابق: **COPS-H2 مغلق (H2-1 … H2-6 مدموجة؛ التفاصيل في `AWJ_COPS_H2_HORIZON_CLOSURE_REPORT.md`؛ التوقف قبل H3 بتفويض المالك).** سجل سابق: **COPS-H2 قيد التنفيذ الذاتي المفوَّض (H2-1 … H2-6):** اعتُمدت القرارات التسعة المتبقية (D-H2-11، 13..20) وفُوِّض Sonnet بالتنفيذ والدمج بالتتابع بشروط التوقف؛ H2-0 مدموج (#1937 ⇒ `0f4606720`، #1938 ⇒ `4768967a9`). **H2-1 (نواة التنفيذ):** مُنفَّذ ومُختبَر — الدمج وSHA في تقرير إغلاق H2. COPS-H1 مغلق (#1936 ⇒ `21b59852c`).
**القاعدة:** يُحدَّث هذا الملف في نهاية كل شريحة (Slice) قبل التوقف. هو نقطة الاستئناف الوحيدة؛ لا يُعاد الاستكشاف.

---

## 1. التفويض الحالي

| البند | الحالة |
|---|---|
| النطاق المفوَّض | **COPS-H1 فقط (H1-0 … H1-5)** — تنفيذ ومراجعة ودمج ذاتي عند اجتياز كل البوابات |
| خارج التفويض | H2 وما بعده؛ أي نشر (Deploy)؛ أي تفعيل بوابة أو ميزة |
| القرارات المعتمدة | D-OPS-1، D-OPS-4، D-OPS-5، D-OPS-6، D-OPS-9، R-1، R-2، R-3، R-5، R-6، R-6b — مسجّلة في `ADR-29` §0 |
| القبول اليدوي | خلف `COMMERCE_ORDER_ACCEPTANCE_ENABLED` (مغلقة افتراضياً) — لا يُفعَّل |

### 1.1 جدول نقاط التوقف لتبديل النموذج (إلزامي)

| المجموعة | النموذج (يبدّله المالك يدوياً) | بعدها |
|---|---|---|
| H1-0 | Claude Opus | STOP ✅ |
| H1-1 | Claude Opus | **STOP** ✅ (هذه النقطة — مغلق بالكامل) |
| H1-2 ثم H1-3 | Claude Sonnet | **STOP** ✅ (هذه النقطة — مفوَّضتان ذاتياً 2026-11-02؛ H1-2 ✅ وH1-3 ✅ مدموجتان) |
| H1-4 | Claude Opus | **STOP** ✅ (هذه النقطة — مفوَّض ذاتياً 2026-11-02؛ مدموج) |
| H1-5 + تقرير إغلاق H1 (`AWJ_COPS_H1_HORIZON_CLOSURE_REPORT.md`) | Claude Sonnet | **STOP** ✅ (هذه النقطة — مفوَّض ذاتياً 2026-11-02؛ مدموج) |

لا تبدأ المجموعة التالية إلا بأمر استمرار صريح جديد من المالك. نقطة التوقف لا تلغي تفويض H1.

---

## 2. الحالة

| Slice | الحالة | PR | Merge SHA | ملاحظات |
|---|---|---|---|---|
| H1-0 | **Merged** (squash، 2026-11-01) — CI أخضر على رأس الـPR؛ لم يُنشر ولم يُفعَّل شيء | #1896 | `d729fc9be46e404ed58289f75802e7eadca5d560` | توثيق فقط. رأس الفرع `59e197726b4ecf11b81a71c562388ba126410355`؛ فُرع من `6d78858d2` ثم تقدّم `main` (أب الدمج `511a19e3f`) دون تعارض. تفاصيل الفحوص في تقرير التنفيذ §3 |
| H1-1 | **Merged** (squash، 2026-11-01) — نجح CI على رأس الـPR `4da6f14`، **لكن بوابة الأداء فشلت لاحقاً على `main` (استقرار القياس لا الصحة)** وعولجت في #1920؛ لم يُنشر ولم يُفعَّل شيء | #1910 | `46774c5c2c2aadc8d173017990b206ef6d877d17` | قرار P-A؛ مقاييس CI وأدلة الوقود في التقرير §8 |
| H1-1 CI recovery | **Merged** (squash، 2026-11-02) — وظيفة `pg-perf` مخصصة + قياس نافذة النشاط؛ 5 تشغيلات مستقلة ناجحة | #1920 | `125abcab70293f4e1b1677a9185ff6ab53575c61` | قرار المالك: Option B + تصحيحات القياس (D-H1-1-PERF-B)؛ `AWJ-COPS-H1-1-CI-PERF-ISOLATION-RECOVERY-REPORT.md` |
| H1-1 closing records | **Merged** — راجع `AWJ-COPS-H1-1-CLOSURE-REPORT.md` | #1917 | `134244ba5fef7253fd043aa21d85b666bd3fedcb` | وثائق فقط |
| H1-2 | **Merged** (squash، 2026-11-02) — SQLite وPostgreSQL والوظيفة المخصصة للأداء وCI Gate خضراء على الرأس `66a2952`؛ لم يُنشر ولم يُفعَّل شيء | #1924 | `790eff709e8c6ba673d30c0739a5eba3cc5e2dfe` | `AWJ-COPS-H1-2-IMPLEMENTATION-REPORT.md`؛ فشلت وظيفة الأداء مرة واحدة على الرأس الأول `b75bb99` (جولة واحدة 88.6ms من 3، توقف تخزين منعزل لا صلة له بالتغيير) ثم نجحت على الرأس التالي بلا تغيير في الحد أو الحمل؛ أُضيف تسجيل تشخيصي فقط |
| H1-2 closing records | **Merged** (وثائق فقط، 2026-11-02) | #1925 | `e05c8e0f3ca125d27af76fda0b174baa66607174` | SHA الدمج لـ#1917/#1924 وأدلة CI/الأداء |
| H1-3 | **Merged** (squash، 2026-11-02) — SQLite وPostgreSQL ووظيفة الأداء المخصصة وCI Gate خضراء على الرأس `3dfcb1dc2cf0a681fe24002a3bf3f6411b993610`؛ Codex بلا ملاحظات مفتوحة؛ لم يُنشر ولم يُفعَّل شيء | #1926 | `f4ae9fc99e3b8ab70faf4e8c08baec2a5a9a3200` | `AWJ-COPS-H1-3-IMPLEMENTATION-REPORT.md`؛ Base الفعلي `ce081f8ca`؛ ملاحظة Codex P2 واحدة (التاريخ يُقتطع قبل التصفية) أُصلحت في `3dfcb1d` باختبار انحدار؛ جدول جديد `commerce_channel_operation_settings` (إضافي)، بلا إنفاذ، بوابة R-6b مغلقة |
| H1-4 | **Merged** (squash، 2026-11-02) — SQLite وPostgreSQL ووظيفة الأداء المخصصة وCI Gate وweb build خضراء على الرأس `4f3c07480b2f3ba1eb7fd119e56f1292460d33ce` من المحاولة الأولى؛ Codex بلا ملاحظات؛ لم يُنشر ولم يُفعَّل شيء | #1932 | `5cca769d34e89cb6ee378e891e0b32c83fe3b8af` | `AWJ-COPS-H1-4-IMPLEMENTATION-REPORT.md`؛ Base `d5e1be954`؛ هجرتان (أعمدة القبول + حراسها؛ مُشغِّلات فقط لـ`merchant_rejected` و`order.accepted`)؛ صلاحية `commerce.orders.manage`؛ البوابتان مغلقتان |
| H1-5 | **Merged** (squash، 2026-11-02) — SQLite وPostgreSQL ووظيفة الأداء المخصصة وCI Gate وweb build (×2) خضراء على الرأس `d9dc6381bfe57220d4cfa26a02418af0af46f74a`؛ لم يُنشر ولم يُفعَّل شيء | #1934 | `76bf5293d180456326cdc7acb8f5b1afd63ed4c8` | `AWJ-COPS-H1-5-IMPLEMENTATION-REPORT.md`؛ Base `1946d3567`؛ بلا هجرة؛ مرشّح `acceptance_status` وحيد في الخلفية؛ ملاحظة Codex P2 واحدة (قفل الإجراءات القديمة حتى نجاح التحديث) أُصلحت في `d9dc638` بـ5 اختبارات؛ البوابتان مغلقتان |
| H1-4 closing records | **Merged** (وثائق فقط، 2026-11-02) | #1933 | `1946d3567552e827941b1b5bd0ba38e0aae71214` | SHA الدمج وأدلة CI + نقطة استئناف H1-5 |
| H1 closing records | **Merged** (وثائق فقط، 2026-11-02) — تقرير `AWJ_COPS_H1_HORIZON_CLOSURE_REPORT.md` | #1935 | `70be922d065cea8375df77ce344f65f702f6e8e4` | Implemented/Tested/Merged/Deployed/Activated/Env-verified مفصولة في التقرير. فشلت وظيفة الأداء مرة واحدة على رأس الـPR (الجولة 3 = 107.17ms، الجولتان الأخريان 15–18ms، كود مطابق لـ`main`) ونجحت بعد إعادة تشغيل واحدة بلا تغيير في الحد أو الحمل؛ التفاصيل التزامنية في التقرير §6.1 كخطر مراقَب |
| H1 final records | **Merged** (وثائق فقط، 2026-11-02) | #1936 | `21b59852c54522c7a441000eb5296c8be02e3834` | SHA الدمج النهائي لـ#1935 + §6.1 (تعثّر الأداء كخطر مراقَب) + أدلة CI على `main` |
| **H2-0** | **Merged** (وثائق فقط، 2026-11-02) — خطة القرار والتنفيذ + اعتماد المالك للقرارات الإلزامية الـ13 وAR-1..AR-3؛ CI (sqlite/pgsql/pg-perf/CI Gate) أخضر على الرأس `7737185c542fd0e9fe20a24ef4c4655ad0a2db0c`؛ Codex: ملاحظة P2 واحدة (إعادة فحص جاهزية الدفع عند كل انتقال تنفيذي — لإلغاء نية COD وحدها) أُصلحت وأُغلق الخيط، وأعاد المراجعة بلا ملاحظات | #1937 | `0f460672062477b6b95313429fb4282dbe361a57` | `AWJ_COPS_H2_0_DECISION_AND_EXECUTION_PLAN.md`؛ **H2-1 لم يبدأ** (يحتاج أمراً صريحاً منفصلاً)؛ لا كود ولا هجرة ولا نشر ولا تفعيل |
| H2-0 records | **Merged** (وثائق فقط، 2026-11-02) | #1938 | *(لا يُسجَّل هنا عمداً — `git log -1 --format=%H -- docs/audits/AWJ_COPS_HORIZON_HANDOFF.md` أو صفحة الـPR)* | SHA الدمج لـ#1937 ونقطة بدء H2-1. **قاعدة منع السلسلة:** PR سجلات الإغلاق لا يُسجِّل SHA نفسه في المستودع (ينتج PR ثانٍ بـSHA جديد وهكذا)؛ SHA الدمج الأخير يُذكر في تقرير المالك ويُستخرج من `git log` |
| H2-1 | **Merged** (squash، 2026-11-02/03 — الأدلة في `AWJ_COPS_H2_HORIZON_CLOSURE_REPORT.md`) — SQLite: 27 اختبار تنفيذ + انحدار؛ PostgreSQL: 9 سباقات تزامن + انحدار 487 اختباراً؛ ضابط سلبي لحارس AR-2 | #1940 | `c129d6a1728d8caaa770b1d17f1ba1fdb5fd8d0e` | `AWJ-COPS-H2-1-IMPLEMENTATION-REPORT.md`؛ الفرع `claude/cops-h2-1-fulfillment-core`؛ هجرة واحدة (`2026_12_31_010000`)؛ بوابة `COMMERCE_ORDER_FULFILLMENT_ENABLED` مغلقة؛ لا أثر مالي/مخزني/حجز |
| H2-2 | **Merged** (squash، 2026-11-02/03 — الأدلة في `AWJ_COPS_H2_HORIZON_CLOSURE_REPORT.md`) — رؤية المقيَّد بمخازن (المخزن الفعّال) للقائمة/التفاصيل/الإجراءات/الانتباه بـ404 موحَّد؛ التغذية تبقى 403؛ SQLite 158 · PostgreSQL 186 | #1942 | `42e27f5ca8aec99263078c52daf5b44daaa32029` | `AWJ-COPS-H2-2-IMPLEMENTATION-REPORT.md`؛ بلا هجرة |
| H2-3 | **Merged** (squash، 2026-11-02/03 — الأدلة في `AWJ_COPS_H2_HORIZON_CLOSURE_REPORT.md`) — واجهة التنفيذ للموظف (إجراءات من العقد، AR-1، مرشّح/شارة)؛ Vitest 187 · Playwright 10×2 | #1943 | `e676ce3b71bf1e89a2862f121e9ee68385c086fb` | `AWJ-COPS-H2-3-IMPLEMENTATION-REPORT.md`؛ ويب فقط |
| H2-4 | **Merged** (squash، 2026-11-02/03 — الأدلة في `AWJ_COPS_H2_HORIZON_CLOSURE_REPORT.md`) — كتلة `fulfillment` العامة الإضافية (قائمة بيضاء، تغيب لبلا صف/ملغى) + `AccountOrderStatus` `gated` بستّ لغات؛ SQLite 12 + انحدار 115 · storefront 3660 | #1944 | `4cc61fec11fcf80ef8eee60bec2b2aa1b62c3b7e` | `AWJ-COPS-H2-4-IMPLEMENTATION-REPORT.md`؛ OpenAPI إضافي؛ بلا هجرة |
| H2-5 | **Merged** (squash، 2026-11-02/03 — الأدلة في `AWJ_COPS_H2_HORIZON_CLOSURE_REPORT.md`) — تتبّع الضيف الموقَّع `trk1` (404 موحَّد، 30/20 في الدقيقة، إسقاط ضيّق، صفحة المتجر)، مغلق افتراضياً؛ SQLite 16 · storefront 3709 | #1945 | `de9b1692eef055062d4f3f37a05a9f66d5c77dc3` | `AWJ-COPS-H2-5-IMPLEMENTATION-REPORT.md`؛ بلا هجرة؛ `COMMERCE_GUEST_ORDER_TRACKING_ENABLED` مغلقة |
| H2-6 | **Merged** (squash، 2026-11-02/03 — الأدلة في `AWJ_COPS_H2_HORIZON_CLOSURE_REPORT.md`) — طابور التحضير المجدول (منطقة اللقطة + حدود القناة)، مرشّح `due`، أسباب `attention` الثلاثة خلف بوابة التنفيذ؛ SQLite 23 + PostgreSQL 129 · web 192 | #1951 | `77d338fa79c19a3b674f0aefefb2556d3c0415ea` | `AWJ-COPS-H2-6-IMPLEMENTATION-REPORT.md`؛ قراءة فقط بلا هجرة |

| H3-0 | **Merged** (وثائق، 2026-11-03) — الخطة وسجل القرارات وADR-30 (Proposed) | #1954 | `23a0beaffb263df3aa5775984accde4d97c43cb8` | `AWJ_COPS_H3_0_DECISION_AND_EXECUTION_PLAN.md`؛ Base `f92eec456`، Head `b7c28d13a` |
| H3-7 | **Merged** (2026-11-03) — دمج التفضيلات + `commerce_alerts.enabled`؛ CI كامل أخضر؛ Codex بلا ملاحظات | #1956 | `c3a84837a12658f35d579d0ec2e5478c5bb20e13` | `AWJ-COPS-H3-7-IMPLEMENTATION-REPORT.md`؛ Head `e60d5172c`؛ بلا هجرة |
| H3-2 | **Merged** (2026-11-03) — محرّك صوت التنبيهات؛ CI كامل أخضر؛ خمس ملاحظات Codex صحيحة أُصلحت | #1955 | `59ed2640bfce7af70200237daf82bdad09f8922f` | `AWJ-COPS-H3-2-IMPLEMENTATION-REPORT.md`؛ Head `766c11297`؛ POS بلا تغيير؛ ويب فقط |
| H3-1 | **Merged** (2026-11-03) — منتج إشعار الطلب الجديد (R-8، R-5) + الجرس في غلاف Commerce؛ مغلق بـ`COMMERCE_ORDER_ALERTS_ENABLED` | #1959 | `f34d0d157642c554905d71337d3bf44e78ce4cc7` | `AWJ-COPS-H3-1-IMPLEMENTATION-REPORT.md`؛ Head `fa83bda83`؛ بلا هجرة |
| H3-3 | **Merged** (2026-11-03) — مركز التنبيه: قائد واحد/جهاز، مصالحة attention، تسليح الصوت، `alerts/config`/`head_seq`/ETag/`pending=1`؛ CI كامل أخضر؛ 11 ملاحظة Codex صحيحة أُصلحت باختبارات انحدار | #1961 | `a1a8c4328cca86e951bb3ffccef978fa64317dc2` | `AWJ-COPS-H3-3-IMPLEMENTATION-REPORT.md`؛ Head `c0eafe349`؛ بلا هجرة |
| H3-4 | **Merged** (2026-11-03) — إقرار لكل طلب (R-10): جدول + حدث `order.acknowledged` + `POST …/acknowledge`؛ CI كامل أخضر؛ 5 ملاحظات Codex أُصلحت | #1962 | `da1b33ee0cff38e3b17a20f760ab4a758d2da2ff` | `AWJ-COPS-H3-4-IMPLEMENTATION-REPORT.md`؛ Head `8ae0c8b25`؛ هجرة إضافية `2027_01_03_010000` |
| H3-قرارات | **Merged** (وثائق) — اعتماد R-8/R-10/R-11/D-H3-01/D-H3-02؛ ADR-30 **Accepted** | #1958 | `97d6cbf77b188390dfe063b55a283f65d06b244f` | `AWJ_COPS_H3_0_DECISION_AND_EXECUTION_PLAN.md` §5 |
| H4-0 | **وثائق** (2026-11-04) — فحص قرائي للتنفيذ الفعلي، نطاق H4-1..H4-7 المتبقي، التحقق من الاعتماديات (H1-3/ADR-19)، سجل قرارات (D-OPS-3/7/8، R-12، D-H4-01..08)، تقسيم PRs. Base `b6aba44` | #1985 | `374397b3d12bbaf1cf1d53547a4283f0464da6bb` | `AWJ_COPS_H4_0_DECISION_AND_EXECUTION_PLAN.md` |
| H4-1 | **Merged** (2026-11-04) — مركز إعدادات المتجر `/commerce/settings` (تنقّل فقط)؛ CI كامل أخضر؛ Codex بلا ملاحظات؛ فشل حارس `capabilities.guard` على أول رأس عُولج بـcommit | #1986 | `aba6d8829c0aed8d43da5edc4265132087e29a9b` | `AWJ-COPS-H4-1-IMPLEMENTATION-REPORT.md`؛ Head `bced89bca73a0a2f4139ef195e98c292fb5f1f4c`؛ واجهة فقط |
| H4-2 | **Merged** (2026-11-04) — محرر مناطق الشحن `/commerce/shipping-zones` (واجهة فقط؛ تفعيل/تعطيل بتأكيد في الصف **وفي حوار التعديل** (Codex P2)؛ **بلا حذف نهائي** D-H4-09)؛ vitest كامل 848 ملفاً أخضر؛ CI Gate أُعيد مرة واحدة بعد انقطاع شبكة في سكربت polling | #1989 | `eabfba6bcead98d99259443c9b6f7970d5efc2c1` | `AWJ-COPS-H4-2-IMPLEMENTATION-REPORT.md`؛ Head `90ce4da7411ceddbe738e98fb3a14d31df0de967`؛ واجهة فقط |
| H4-3 | **Merged** (2026-11-04) — تحكّمات استقبال القناة (تخزين فقط): إيقاف/رسالة/استئناف مجدول، سياسة خارج الساعات، حدّ أدنى، ساعات أسبوعية؛ هجرة `2027_01_05_010000`؛ بوابة `COMMERCE_CHANNEL_INTAKE_CONTROLS_ENABLED` **مغلقة**؛ لا إنفاذ؛ Codex P2 (varchar(200) ⇒ 22001) أُصلح | #1992 | `ae5baf8d92d1a770daa61b65b61d58d74694b4cd` | `AWJ-COPS-H4-3-IMPLEMENTATION-REPORT.md`؛ Head `483debe63eb0993910edbf0e3b77986d883b7b1d` |
| H4-3-UI | **Merged** (2026-11-04) — شاشة «تشغيل المتجر» `/commerce/store-operations` (إيقاف/ساعات/حدّ أدنى) فوق عقد H4-3؛ Codex P2×2 أُصلحا (`rebaseDraft` بعد تعارض النسخة + قفل الحقول أثناء الحفظ)؛ vitest كامل 867 ملفاً أخضر | #2000 | `28e02e183ec7ef47ec3cc21da986c09b1836c6a0` | `AWJ-COPS-H4-3-UI-IMPLEMENTATION-REPORT.md`؛ Head `3e49284cc328371184454dd8bd42f71dbef9a011`؛ واجهة فقط |
| H4-4 | **Merged** (2026-11-05) — إنفاذ الإيقاف/خارج الساعات/الحدّ الأدنى عند إنشاء الطلب + كتلة `data.ordering` العامة + رسائل المتجر (6 لغات)؛ **خلف البوابة المغلقة**؛ سباق إيقاف↔إتمام على PostgreSQL بلا جمود؛ Codex بلا ملاحظات | #1999 | `a4d308ab9c22eac2cd3fb48a17d4cd2863428445` | `AWJ-COPS-H4-4-IMPLEMENTATION-REPORT.md`؛ Head `5fb0806b14df5d6d3dd8ec8171dea10eb3c3c741` |
| H4-5 | **Merged** (2026-11-04) — سياسات الطلب الإلكتروني `/commerce/order-policies` (تحرير مدة حجز الدفع فقط D-H4-07؛ الباقي قراءة)؛ Codex P2×2 أُصلحا (حقل تجريبي + أرقام نصية) | #1995 | `0215b70c7bd5b70d1ba78db1b337858b0ab85ef1` | `AWJ-COPS-H4-5-IMPLEMENTATION-REPORT.md`؛ Head `32d94fe0aacaf86a8cc9fd435aabbcc612d4e323`؛ واجهة فقط |
| H4-6 | **Merged** (2026-11-05) — إتاحة وسيلة الدفع لكل قناة: `payment-methods/{id}/channel-availability` بصلاحيتي المدفوعات والتجارة معاً + قسم في شاشة الوسيلة (D-H4-06)؛ Codex بلا ملاحظات | #1996 | `0b08ea07a9f4f58c251063ccd124cc802d3ba6c1` | `AWJ-COPS-H4-6-IMPLEMENTATION-REPORT.md`؛ Head `57223be1119ad359703f144e88b04bb3b729fc86` |
| H4-7 | **Merged** (2026-11-04) — وسم صفحتي `sales-settings/orders\|shipping` «غير مُطبَّق» (R-12 ب)؛ واجهة فقط | #1994 | `67ca31e5f67099443ca8bd389043e36b929fd42e` | `AWJ-COPS-H4-7-IMPLEMENTATION-REPORT.md`؛ Head `83210f0ca2a8b592f537d32e7344766a41f68572` |
| H4-إغلاق | **وثائق** (2026-11-05) — تقرير الإغلاق + أقسام CLAUDE.md وADR-29 §2.5.3 المؤجَّلة من PRs الشرائح لتفادي تعارضات وثائق مشتركة | (PR الإغلاق) | (يُسجَّل عند الدمج) | `AWJ_COPS_H4_CLOSURE_REPORT.md` |

> **Implemented ≠ Merged ≠ Deployed ≠ Activated ≠ Env-Verified.** لا شيء من COPS منشور أو مُفعَّل.

---

## 3.H4.0 القرارات المعتمدة لـH4 (2026-11-04)

اعتُمدت **كل** توصيات `AWJ_COPS_H4_0_DECISION_AND_EXECUTION_PLAN.md` §4 (مسجَّلة أيضاً في ADR-29 §0). **التفويض:** H4-3 ← H4-4 ثم H4-5/H4-6/H4-7، فرع وPR مستقل لكل شريحة، دمج ذاتي بعد CI + Codex بلا ملاحظات مفتوحة، ثم تقرير إغلاق `AWJ_COPS_H4_CLOSURE_REPORT.md`. **حدود:** لا تفعيل لـ`COMMERCE_CHANNEL_INTAKE_CONTROLS_ENABLED` (يتوقف الأفق قبل تفعيل بوابة Checkout) · لا Railway/متغيرات إنتاج/نشر يدوي · لا تغيير محاسبي/ضريبي/مخزني · لا توسيع صلاحيات ولا إضعاف عزل المستأجر · لا تخفيف CI أو حدّ FeedHead 50ms · لا H5/H6/Web Push · تعارض معماري جوهري أو تغيير مالي غير منصوص عليه ⇒ توقف ورجوع للمالك.

## 3.H4 نقطة الاستئناف — COPS-H4 (اكتمل النطاق المفوَّض 2026-11-05)

**الحالة: النطاق المفوَّض مكتمل (H4-0 … H4-7 مدموجة).** التقرير النهائي (الشرائح، الملفات، الاختبارات، CI، Codex، PR/Head/Merge SHA، المخاطر، المتبقي): `docs/audits/AWJ_COPS_H4_CLOSURE_REPORT.md`. القرارات الأربعة عشر معتمدة (2026-11-04) ومسجَّلة في ADR-29 §0.
**الخطوة التالية: لا شيء مفوَّض.** **تفعيل البوابة `COMMERCE_CHANNEL_INTAKE_CONTROLS_ENABLED` NO-GO حتى** قرار تفعيل منسَّق مستقل (إنفاذ Checkout مبنيّ ومغلق). لا Railway ولا نشر. خارج التفويض: H5 وH6 وWeb Push وH3-6 (تذكير/تصعيد)، وحذف مناطق الشحن نهائياً (D-H4-09 ج مؤجَّل).
**ثوابت لا تزال سارية:** لا قيد ولا مخزون من COPS؛ الإنفاذ عند الإنشاء فقط؛ القارئ الوحيد لجدولي الاستقبال `CommerceChannelOperationsSettingsService`؛ ترتيب الأقفال ADR-19 §2.3 بلا تغيير.

## 3.H3 نقطة الاستئناف — COPS-H3 (اكتمل النطاق المفوَّض 2026-11-03)

**الحالة: النطاق المفوَّض مكتمل (H3-0 · H3-1 · H3-2 · H3-3 · H3-4 · H3-7 مدموجة).** التقرير النهائي (PR/Base/Head/Merge SHA، الاختبارات، CI، Codex، المخاطر، GO/NO-GO): `docs/audits/AWJ_COPS_H3_FINAL_REPORT.md`. القرارات الخمسة معتمدة وADR-30 **Accepted**.
**الخطوة التالية: لا شيء مفوَّض.** H3-5 تنتظر **مرجعاً بصرياً من المالك** (المتطلبات جاهزة في `docs/plans/store/AWJ_COPS_H3_5_RECEPTION_WORKSPACE_REQUIREMENTS.md`). H3-6 (D-OPS-3 + H4-3) وH3-P وH4 وH2-7 وH2-8 خارج التفويض ولم تُبدأ. **تفعيل البوابة `COMMERCE_ORDER_ALERTS_ENABLED` NO-GO حتى** قرار تفعيل مستقل + اختبار أجهزة حقيقي. لا نشر ولا Railway.

## 3.A نقطة الاستئناف الحالية — H2 (تنفيذ ذاتي مفوَّض بالتتابع H2-1 … H2-6)

**الحالة:** H1 مغلق. H2-0 مدموج واعتُمدت **كل** قراراته (الـ13 + AR-1..AR-3 + التسعة D-H2-11 وD-H2-13..20) كما هي موصى بها في `AWJ_COPS_H2_0_DECISION_AND_EXECUTION_PLAN.md`. فُوِّض Claude Sonnet بتنفيذ ودمج H2-1 … H2-6 بالتتابع بلا تأكيد روتيني، **بشروط التوقف:** تعارض معماري غير محسوم · تغيير مالي/مخزني غير معتمد · خطر أمن أو عزل مستأجر · خرق ترتيب الأقفال أو جمود غير محلول · تغيير جوهري للقرارات · فشل CI مطلوب مستمر. **ثوابت:** بوابات مغلقة افتراضياً · لا نشر ولا تفعيل · لا قيود/فواتير/حركات مخزون/حجوزات جديدة · H2-7/H2-8 مؤجلتان · لا H3 · لا إعادة بوابة الأداء حتى الخضرة ولا تغيير حدها 50ms · التوقف بعد تقرير إغلاق H2 الكامل (`AWJ_COPS_H2_HORIZON_CLOSURE_REPORT.md`، يُسجَّل فيه كل PR وSHA — **لا PRs سجلات SHA منفصلة**).

**ما أنتجه H2-1 (لما بعده):** جدول `commerce_order_fulfillments` + `CommerceOrderFulfillmentService` (الكاتب الوحيد) + `CommerceOrderFulfillment` + حارس الكاتب الوحيد لإلغاء النية + الصف 14 + أحداث `fulfillment.*` + كتلة `fulfillment` و`fulfillment_actions` و`fulfillment_status` في قراءة الموظف + `operational_status` الممتد. للمقيَّد بمخازن: لا يزال 403 على كل مسارات الطلبات (H2-2 يرفعه). تفاصيل الحقول: تقرير H2-1. **ثوابت لا تُكسر:** الأقفال النية ← الطلب ← التنفيذ ← رأس التغذية آخراً؛ لا عمود حالة تنفيذ على الطلب؛ كل نوع حدث جديد = حدث نطاق + `DATA_KEYS`؛ الفحوص العابرة للجداول على SQLite في الكاتب لا في مُشغّلات (تكسر إعادة بناء `commerce_orders`).

**جاهزية التفعيل (2026-11-03):** `AWJ_COPS_BETA_ACTIVATION_READINESS_REPORT.md` — **GO مشروط** لتفعيل `COMMERCE_ORDER_FULFILLMENT_ENABLED` وحدها على `nibras-api` (Beta) بعد إغلاق أدلة P1–P3 (أهلية CORD-2026-00002، سياسة المخزن، فحص مخطط الجدول) وبموافقة صريحة منفصلة؛ H2 منشور (`340f6b1`) وغير مفعَّل؛ لا عيوب جاهزية.

**الخطوة التالية:** لا شيء مفوَّض. H2 مغلق (`AWJ_COPS_H2_HORIZON_CLOSURE_REPORT.md`). أي استئناف (H3 أو H2-7/H2-8 أو قرار تفعيل أو قرار A/B/C لبوابة الأداء) يحتاج أمراً صريحاً منفصلاً من المالك؛ لا نشر ولا تفعيل بلا موافقة مستقلة.

**ما أنتجه H1-5:** مرشّح `GET commerce/orders?acceptance_status=awaiting_acceptance|accepted|auto` (مشتقّ من الحقائق، يطابق المُسقِط، مغلق بالبوابة)؛ واجهة تفاصيل الطلب تعرض «قبول/رفض» من `accept_action`/`reject_action` + الصلاحية فقط (الرفض يتطلب `manage` و`cancel`)، بقفل إرسال مكرر وقفل حالة قديمة على مستوى الصفحة حتى نجاح التحديث؛ شارة قبول ومرشّح واختصار «بانتظار القبول» في القائمة. كتابات الويب الجديدة معزولة في `accept-order.ts` (POSTان فقط، يحرسهما `orders-readonly.test.ts`). **لا قبول/رفض من صفوف القائمة** (الملخّص بلا عقد إجراء)، و**لا واجهة attention/feed** (H3).

**قرار H1-5 المفتوح سابقاً (مرشّح `operational_status`) حُسم:** اكتُفي بمرشّح `acceptance_status` المشتقّ من الحقائق الأصلية، لا ترجمة الإسقاط إلى SQL.

**قرارات مفتوحة للمالك:** (1) تأكيد تفسير `attention` (`new_order` + نافذة 48 ساعة للتلقائي، و`awaiting_acceptance` بلا نافذة) — الواجهة لا تستهلكه بعد؛ (2) قرار تفعيل منسَّق للبوابتين (القبول والإلغاء) قبل أي مستأجر حي؛ (3) أمر بدء H2.

**ما أنتجه H1-2:** أحداث النطاق بعد الالتزام (معرّفات فقط؛ **كل نوع سجل جديد يتطلب حدث نطاق** وإلا فشل `CommerceOrderFeedTest`؛ المستمعون لا يرمون) · `GET commerce/orders/feed` و`attention` · أي مسار Commerce جديد يلزمه سطر في `CommerceModuleBoundaryTest`.

**ما أنتجه H1-3:** `commerce_channel_operation_settings` (الكاتب الوحيد `CommerceChannelOperationsSettingsService`، `expected_version` إلزامي)؛ المستهلك الوحيد للجدول خارج الخدمة صار `acceptanceModeForNewOrder()` (يحرسه اختبار «مستدعٍ واحد»).

**ما أنتجه H1-4 لـH1-5 وما بعده:**
- عقد قراءة الموظف: `operational_status` (`cancelled|draft|awaiting_payment|payment_cancelled|awaiting_acceptance|accepted`) و`acceptance` `{mode, effective_mode, accepted_at[, by]}` في القائمة والتفاصيل؛ `accept_action`/`reject_action` `{available, blocked_reason}` في التفاصيل **فقط** مع البوابة والصلاحية (غيابهما = لا إجراء، كنمط `cancel_action`). الواجهة تعرض الإجراء من هذه المفاتيح وحدها، و409 ⇒ تحديث.
- الكتابة: `POST commerce/orders/{id}/accept` (بلا جسم) و`/reject` (`note` اختياري ≤ 500). الرفض يظهر في كتلة الإلغاء بسبب `merchant_rejected` (تسمية عربية مطلوبة في الواجهة؛ ليس من أسباب حوار الإلغاء الستة).
- **قرار H1-5 مفتوح:** مرشّح `operational_status` في القائمة غير مبني (يحتاج ترجمة الإسقاط إلى SQL أو اكتفاء بمرشّحات الحقائق الأصلية).
- لا مستهلك للتذكير/التصعيد حتى H3-6؛ H2 يضيف حالات التنفيذ **بعد** `accepted` في المُسقِط نفسه.
- تفسير `attention` (`new_order` + 48 ساعة، ADR-29 §2.4.2) ما زال **ينتظر تأكيد المالك**؛ `awaiting_acceptance` بلا نافذة (§2.2.1).

**ثوابت لا تُكسر:** الرأس صف قفل ثابت لا يُحدَّث؛ `max+1` بعبارة واحدة؛ الكاتب لا يلمس `tenants`؛ الرأس آخر قفل؛ القراءة بلا أقفال؛ القبول/الرفض على محور النية ← الطلب؛ حقائق القبول والإلغاء تكتبها `CommerceOrderLifecycleService` وحدها؛ بوابة الأداء المخصصة (§3.B). **SQLite:** لا تضف مفتاحاً أجنبياً على `commerce_orders` عبر Schema Builder (يعيد بناء الجدول ويُسقط مُشغِّلات الحراس بصمت) — استعمل `ADD COLUMN … REFERENCES` الأصلية.

**الفرع:** `claude/cops-h2-...` من أحدث `origin/main` (يُنشأ عند البدء، بأمر صريح فقط).

## 3.B قاعدة بوابة الأداء في CI (تسري على كل شريحة COPS قادمة)

- **اختبارات الأداء/الكمون لا تعمل في الجناح المتوازي.** وسِمها `#[Group('cops-h1-1-perf')]` (أو مجموعة أداء موثَّقة جديدة) وابدأ الاختبار بـ`isolateFromParallelWorkers()`؛ تتخطّى نفسها داخل عمّال ParaTest وتعمل في وظيفة CI **`PostgreSQL feed-lock performance (COPS-H1-1)`** (`pg-perf`، مشغّل خاص، فحص مطلوب `always` في CI Gate).
- **سجِّل قبل أن تؤكّد** (`recordMetrics` ثم التأكيدات)، وافصل **إنتاجية نافذة النشاط** عن **إنتاجية الجولة الكلية** (تشمل تفرّع العمليات ≈1s على مشغّل بأربع vCPU)، وأعلن أي إحماء كجولة مسجَّلة ومستبعدة. لا ترفع الحد 50ms ولا تخفّف الحمل ولا تحوّل البوابة إلى advisory بلا موافقة صريحة من المالك.
- **لا تدفع commit إلى PR بينما تشغيل تحتاجه جارٍ** (concurrency يلغي runs الـPR عند push)؛ للحصول على تشغيلات مستقلة إضافية استعمل `workflow_dispatch` على الفرع.
- **أي PR يضيف فحصاً مطلوباً** يلزمه سطر في `.github/ci-gate/required-checks.json` وتحديث تثبيتات `scripts/ci-gate/test_ci_gate.py`؛ وخطوات تجميع `pg-perf` يحرس تطابقها مع `test` الاختبار `scripts/ci-gate/test_perf_job_parity.py`. شغّل محلياً `scripts/ci-gate` و`scripts/ci-watchdog` و`scripts/ci-perf` قبل دفع أي تعديل على `ci.yml` (فاتني `ci-watchdog` مرة).
- **سجل التكرار (حتى 2026-11-02):** تعثّرت الوظيفة ثلاث مرات على تغييرات **وثائقية/غير مؤثرة**: H1-2 (`b75bb99`)، #1935 (`3f4e965`، نجحت بإعادة واحدة)، و`main@21b59852c` (دمج #1936: إحماء 196ms، الجولات 20.0/48.3/76.3ms، `iowait` حتى 7.2%، `steal` 0، بلا checkpoints، سلامة التسلسل سليمة؛ لم يُعَد تشغيله لأنه استُبدل بتشغيل `main` التالي الناجح). نجحت على `main@70be922d0` و`@0f4606720` وكل رؤوس PRs الأخرى. **لم يُمَسّ الحد ولا الحمل.** قرار المالك المفتوح: سياسة انتظار هدوء/حصر الجولات المحتسبة.
- **خطر معلن:** توقفات عشوائية لـfsync/القرص (≈2.8% من الجولات محلياً: 124ms و170ms) قد تُفشل جولة؛ لم تظهر في 15/15 جولة CI. التكرار ⇒ توقّف وصعّد بالقياسات.

## 3.0 (تاريخي) نقطة التوقف عند قرار D-H1-1-P — **حُسم P-A**

H1-1 على الفرع `claude/cops-h1-1-order-events-feed` (PR مفتوح غير مدموج). التنفيذ مكتمل؛ الصحة مثبتة (اكتمال/تراجع/لا جمود مع ضابط سلبي/الرأس آخر قفل مع تحقق طفري/عزل/RBAC/لا أثر مالي). **المانع الوحيد:** بوابة الأداء R-2 بتعريفها الحرفي (اندفاع مشبَع). الخيارات P-A (موصى به: تعريف حمل واقعي ≤ ~130 حدثاً/ث/مستأجر، p95 ≈ 24ms) · P-B · P-C · P-D في التقرير §5.

**بعد القرار:** على الفرع نفسه — عدّل اختبار البوابة وفق القرار المعتمد حرفياً (لا تخفيف آخر)، أعد CI (sqlite + pgsql + CI Gate)، راجع، ادمج، سجّل Merge SHA هنا وفي المتتبّع، ثم **توقف** عند نقطة تبديل النموذج قبل H1-2.

**تعديل تصميمي داخل R-2 (موثَّق في ADR-29 §2.4.1):** الرأس صف قفل ثابت لا يُحدَّث، والتسلسل `max(feed_seq)+1` بعبارة إدراج واحدة؛ الكاتب لا يلمس `tenants` (FK الحدث إلى الرأس؛ الرأس يولد مع المستأجر بمُشغّل).

## 3. (مرجع تاريخي) نقطة استئناف H1-1 كما خُطِّطت (Claude Opus)

**الهدف:** `commerce_order_events` + `commerce_order_feed_heads` + حراس قاعدة البيانات + كتابة الأحداث الأولية + بوابات التحقق على PostgreSQL. **لا** مسارات API جديدة (H1-2)، **لا** واجهة، **لا** قبول.

**المرجع الحاكم:** `docs/plans/store/ADR-29-COMMERCE-ORDER-OPERATIONS.md` §2.1 و§2.4 (العقد كاملاً)، Revision 1 §2.

**ابدأ بقراءة فقط:**
1. ADR-29 §2.4.
2. ADR-28 §1.3 (ترتيب الأقفال القائم) و§4.
3. نمط حراس السلسلة: `docs/audits/horizon/REM-18b-1-IMPLEMENTATION-REPORT.md` + هجرته (مُشغِّلات PG/SQLite: «الرأس يتقدّم +1 بمدخل مقابل»).
4. نمط حراس الإلغاء: `database/migrations/2026_12_13_010000_add_cancellation_facts_to_commerce_orders.php`.
5. نمط اختبارات التزامن: `tests/Feature/CommerceOrderCancellationPostgresTest.php`، `CommerceOnlinePaymentPostgresConcurrencyTest.php`.

**نقاط الكتابة الأولية (الأنواع الأربعة):**

| النوع | المعاملة المالكة (حيث يُفرَغ المسجِّل آخراً) | ملاحظة |
|---|---|---|
| `order.placed` | `CommerceCheckoutService::complete` (المعاملة الخارجية؛ **ليس** `createFromCheckout` لأن النية والحجز وتحديث الـcheckout تليه) | المسار القديم `CommerceOrderService::create/confirm` بلا مستهلك HTTP — يُقرَّر صراحةً (حدث أو لا) ويُوثَّق |
| `order.cancelled` | `CommerceOrderLifecycleService::cancel` (`DB::transaction` L53) — آخر عبارة قبل الالتزام، قبل تسجيل `afterCommit` للتنظيف | `data.reason` فقط (لا ملاحظة، لا فاعل خارج `actor_*`) |
| `payment.paid` | `CommerceOnlinePaymentService::completeCaptured` (`DB::transaction` L208) | **تحقق إلزامي:** له 5 مستدعين (المستمع `CompleteCommerceOnlinePayment`، المكنسة، 3 داخلية). إن كان أيٌّ منها **داخل معاملة خارجية** فقفل الرأس سيُؤخذ قبل أقفال لاحقة للمعاملة الخارجية ⇒ يكسر «الرأس آخراً». الحل المسموح: تأجيل الإفراغ إلى المالك الخارجي (المسجِّل واعٍ بمستوى المعاملة). إن تعذّر بلا تغيير سلوك ⇒ **توقف وصعّد** (شرط «افتراض تصميمي أساسي يفشل») |
| `payment.collected` | `CommercePaymentIntentService::markCollected` (`DB::transaction` L112) | تحقق مماثل من التعشيش |

**معايير القبول (من ADR-29 §2.4):** الحدث داخل معاملته (فشله يُرجعها)؛ الرأس آخر قفل في كل مسار؛ حراس PG+SQLite (إدراج متتالٍ فقط، لا UPDATE/DELETE/TRUNCATE، لا حدث لمستأجر آخر)؛ `down()` يرفض متى وُجد حدث؛ تصنيف `CompanyWide` للنموذجين في `BranchIsolationGuardTest`؛ لا PII في `data`؛ اختبارات PG الستة (تأخر الالتزام، التراجع، لا 40P01، الاكتمال، الحراس، **قياس الأداء** مع حد التصعيد p95 > 50ms إضافية تحت 20 كاتباً)؛ `php artisan test` كاملاً + أجنحة PG ذات الصلة؛ **لا** تعديل لاختبارات قائمة، لا قيد، لا حركة مخزون، استجابات الجمهور حرفياً كما هي.

**الفرع المقترح:** `claude/cops-h1-1-order-events-feed` من أحدث `origin/main`.

---

## 4. ثوابت لا تُكسر (كل الشرائح)

- ترتيب الأقفال: المحور القائم `Attempt → Intent → Order → (Fulfillment) → Reservations`؛ أقفال المسارات الأخرى بترتيبها الحالي؛ **`commerce_order_feed_heads` آخراً دائماً**.
- لا شبكة ولا مزوّد دفع تحت أي قفل؛ التنظيف والمستمعون بعد الالتزام ولا يرمون.
- لا كتابة في الأستاذ/المخزون من Commerce؛ H1 بلا أي قيد أو حركة مخزون (يُذكر في كل PR).
- لا enum جديد في `commerce_orders.status`؛ لا عمود حالة دفع/تنفيذ/تشغيل مخزَّن.
- عقود الجمهور: كتل إضافية فقط؛ اختبارات العقود القائمة بلا تعديل.
- كل سلوك جديد: افتراض يطابق اليوم أو بوابة مغلقة. لا تفعيل.
- `commerce.orders.*` لـowner/admin عبر `*` فقط؛ لا `MATRIX` ولا زرع.
- لا وعد موثوقية تنبيه خارج «الوضع المدعوم» (Revision 1 §3).

## 5. القرارات المتبقية (لا تُفترض)

قبل H4 (جدول القرارات الكامل بالخيارات والتوصيات في خطة H4-0 §4): D-OPS-7، D-OPS-8، R-12، D-H4-01..08. (سابقاً: R-4، R-7، R-8، R-10، R-11، R-12، D-OPS-3 (`auto_reject`)، D-OPS-4b، D-OPS-4c، D-OPS-7، D-OPS-8، D-9-A1، تفعيل الإلغاء على Beta — حُسم معظمها في H2/H3).
محجوبة لـFPC: D-7، D-8 (+رأي ضريبي)، D-10، D-11 (+PAY-V2-6A)، D-12 + ADR-COMMS D1–D9، D-OPS-10، D-OPS-11، R-9، بدء H3-P.

## 6. خريطة القراءة

| الوثيقة | الدور |
|---|---|
| `docs/plans/store/ADR-29-COMMERCE-ORDER-OPERATIONS.md` | العقد الملزم |
| `docs/plans/store/ADR-28-COMMERCE-ORDER-LIFECYCLE.md` | الإلغاء وترتيب الأقفال (Accepted) |
| `docs/audits/AWJ_COMMERCE_OPERATIONS_H0_REVISION.md` | الخطة والاعتماديات والقرارات (يحلّ محلّ §E/§G/§H من H0) |
| `docs/audits/AWJ_COMMERCE_OPERATIONS_AUDIT.md` | الواقع المثبت (§A–§D، §F) |
| `docs/plans/store/AWJ_STORE_COMMERCE_HORIZON_TRACKER.md` §9 | حالة الشرائح |
| `docs/audits/AWJ-COPS-H1-*-IMPLEMENTATION-REPORT.md` | تقارير الشرائح |
