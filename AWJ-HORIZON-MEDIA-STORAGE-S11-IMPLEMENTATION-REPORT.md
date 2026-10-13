# AWJ-HORIZON-MEDIA-STORAGE — S11/S12 Implementation Report (الفحص الأمني لمركز المستندات)

> **قرار المالك:** الخيار (أ) — ClamAV حقيقي، بلا تجاوز للفحص ولا استثناءات ملفات. ميزانية ≤ 25$ شهرياً، شبكة خاصة فقط، إصدار ثابت، `QUEUE_CONNECTION` لا يُمسّ عالمياً.

## 1. ما وُجد في المستودع (لم يُعَد بناؤه)
| المكوّن | الحالة |
|---|---|
| `ClamAvTcpDocumentSafetyScanner` (zINSTREAM/zPING) · تكامل `malware_scanner` (`clamav_tcp`: host/port/timeout) | موجود |
| `ScanDocumentFile` (محاولات + backoff + `FAILED` عند الاستنفاد) · `DocumentFileScanService` (CLEAN/INFECTED/FAILED، INFECTED/FAILED ⇒ الحزمة QUARANTINED) | موجود |
| بوابة التنزيل: `scan_status === CLEAN` فقط (422 غير ذلك) | موجود |
| مسار retry يدوي لتشغيلات FAILED (`document-processing-runs/{run}/retry`) | موجود |
| وضع المعالجة `sync` (inline) في تكامل `document_ai.processing_mode` | موجود |

**العقود:** `DocumentScanStatus` = `pending | clean | infected | failed`. ERROR وTIMEOUT يُعبَّر عنهما بـ`failed` (استثناء من الفاحص ⇒ إعادة محاولة محدودة ثم `failed`) — fail-closed.

## 2. الفجوة التي وُجدت
1. لا خدمة فاحص في Railway.
2. `QUEUE_CONNECTION=sync` في Production و`processing_mode=async` الافتراضي ⇒ `queueSafetyScans` يعيد 0: **لا فحص يعمل أبداً** حتى مع فاحص مُعدّ.
3. فحص يُنشأ فقط عند «إكمال الدفعة»: ملف استُقبل قبل إعداد الفاحص يبقى `pending` بلا تشغيل إلى الأبد.

## 3. S11 — الكنّاس `documents:sweep-scans` (تطبيق، بلا تكلفة)
- يلتقط `pending` الأقدم من العتبة: بلا تشغيل ⇒ يُنشئ ويُرسل عبر `queueSafetyScans` القائم؛ تشغيل QUEUED/RUNNING قديم ⇒ يُعاد إرساله حتى `max_attempts` ثم يُغلق `failed` (fail-closed)؛ تشغيل FAILED ⇒ يُعدّ ويُنبَّه فقط (retry قرار بشري).
- **لا يعلّم أي ملف CLEAN**؛ CLEAN لا يأتي إلا من فاحص فعلي.
- **فاحص غير قابل للوصول ⇒ لا يستهلك ميزانية المحاولات**؛ يُنبَّه `document_scanner_unreachable` فقط.
- منع التكرار: قيد idempotency الفريد على التشغيل + `ShouldBeUnique` على المهمة (اختبار: كنسان لا يُنشئان تشغيلاً ثانياً ولا مهمة ثانية).
- التنبيهات: سجل `document_scan_stuck` / `document_scanner_unreachable` بأعداد فقط — **لا معرّف مستأجر/ملف ولا مضيف** (اختبار صريح)، ورمز خروج غير صفري.
- الجدولة: `Schedule::command('documents:sweep-scans')->everyTenMinutes()`؛ خدمة Railway القائمة **`awj-scheduler`** (cron `*/5 * * * *` ⇒ `php artisan schedule:run`) تنفذه — بلا تكلفة إضافية.

## 4. S12 — تحقق الجاهزية `awj:documents-scanner-verify`
PING + `zVERSION` (قاعدة تواقيع محمّلة > 0) + EICAR القياسي ⇒ INFECTED + عيّنة نظيفة ⇒ CLEAN، بتدفقات في الذاكرة فقط (لا ملفات مستأجرين، لا تخزين، لا كتابة DB، لا أسرار).

## 5. البنية (Railway، خدمة جديدة `awj-clamav`)
| البند | القيمة |
|---|---|
| الصورة | `clamav/clamav:1.4.6` (إصدار ثابت من سلسلة LTS 1.4؛ **ليس** latest) |
| الشبكة | `awj-clamav.railway.internal:3310`، **بلا نطاق عام ولا TCP proxy** |
| الموارد | سقف 3GB RAM · 1 vCPU (الفوترة بالاستهلاك الفعلي؛ ذروة إعادة تحميل التواقيع تتطلب هامشاً) |
| تخزين | Volume 1GB على `/var/lib/clamav` — التواقيع تبقى بعد إعادة النشر |
| إعادة التشغيل | `ON_FAILURE` حتى 10 محاولات |
| التكلفة التقديرية | ≈ 15–20$/شهر (ذاكرة ≈ 1.5GB × 10$ + CPU ضئيل + volume) — **تُراجَع بالاستهلاك الفعلي (E-)** |
| الإقلاع (سجلات) | freshclam نزّل التواقيع: daily 28150 (355,760) · main 63 (3,287,027) · bytecode 339؛ clamd بدأ |

**تقييد الوصول (إفصاح):** شبكة Railway الخاصة على مستوى المشروع، لا ACL لكل خدمة. لا شيء غير خدمات أَوْج في المشروع؛ clamd بلا مصادقة (خاصية البروتوكول) ⇒ الخطر المتبقي: خدمة داخلية مخترَقة تستطيع إرسال أوامر clamd (مثل SHUTDOWN) = **توفّر فقط** (الفشل fail-closed ولا تنزيل لأي ملف)، وإعادة التشغيل ON_FAILURE تعيد الخدمة. لا كشف لملفات مستأجرين من الفاحص (لا يخزنها؛ INSTREAM).

## 6. ما يبقى للتفعيل
1. دمج S10 وS11 ونشرهما.
2. المالك (شاشة المنصة، بلا أسرار): تكامل `malware_scanner` = `clamav_tcp` · `awj-clamav.railway.internal` · `3310` · مفعَّل؛ وبطاقة `document_ai`: `processing_mode = sync` (المحرك يبقى معطّلاً).
3. المالك أو أنا: `php artisan awj:documents-scanner-verify` من Console ⇒ كل الخطوات PASS.
4. أنا: ملف سليم ⇒ CLEAN ⇒ تنزيل ببصمة مطابقة؛ EICAR (عبر أمر التحقق فقط، لا رفعه كملف) ⇒ INFECTED؛ كنس الملفات العالقة؛ عزل A/B؛ ثبات بعد إعادة النشر.

## 7. تقييم المعالجة المتزامنة مقابل Worker/Queue مخصّصة
- **sync مقبول مرحلياً:** حدّ الملف 20MB و10 ملفات/دفعة؛ فحص clamd لملف 20MB ≈ ثوانٍ؛ فشل/مهلة الفاحص ⇒ `failed` ⇒ لا تنزيل. الخطر: زمن طلب «إكمال الدفعة» يطول مع دفعة كبيرة (حد زمن Apache/Railway proxy ~5 دقائق؛ مهلة المقبس ≤ 30ث لكل عملية).
- **Worker مستقل (بلا تأثير على البريد):** يتطلب `QUEUE_CONNECTION=database` (جدول jobs موجود) على الخدمة العاملة **ومنتِجي** المهام، وتغيير الاتصال الافتراضي عالمياً يحوّل كل مهام التطبيق المتزامنة اليوم إلى غير متزامنة. البديل الأنظف: اتصال طابور مسمّى `documents` (قاعدة بيانات) مخصّص لمركز المستندات فقط دون تغيير `default`، مع عامل `queue:work documents --queue=documents` في خدمة مستقلة (≈ 2–3$/شهر). **ليس ضرورياً للإنتاج الآن** — يُقترح فقط إن تجاوزت أحجام الدفعات الحدّ المقبول؛ قرار مؤجَّل مع معيار: زمن `complete` p95 > 20ث.
