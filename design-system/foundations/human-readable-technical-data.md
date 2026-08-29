# Human-readable UI · Technical details on demand

> **مبدأ إلزامي للواجهة:** أي مفتاح داخلي (`snake_case`) أو UUID أو JSON خام
> **لا يظهر في الطبقة الأساسية (primary UI)** إلا إذا كانت له ضرورة تشغيلية واضحة
> يفهمها المدير/المحاسب/المشرف دون سياق مطوّر.

## القاعدة

| الطبقة | ماذا تُعرض | أمثلة |
|---|---|---|
| **Primary** | تسمية بشرية، حالة، مبلغ، وقت، سبب | «تكرار طلبات الموافقة»، «الإصدار 1»، «ملغاة» |
| **Secondary (on demand)** | مفاتيح تقنية، معرّفات، حمولات خام | `approval_replay`، `correlation_id`، JSON قبل/بعد |

لا تُحذف الأدلة التقنية. تُنقل إلى مكوّن `TechnicalDetails`
(`web/src/components/ui/technical-details.tsx`) — مطوي افتراضياً، مع نسخ، ولفّ آمن للجوال.

## متى تستخدم `TechnicalDetails`

- تفاصيل حدث رقابي / استثناء / تحقيق
- لقطات before/after الخام
- أي payload أو provenance يحتاج مراجعته مهندس أو مدقّق تقني

## متى لا تستخدمه كطبقة أولى

- بطاقة قاعدة كشف، صف جدول تشغيلي، ملخص حدث للمراجع
- شارات الحالة والمعرّفات القصيرة التشغيلية (رقم جلسة، رقم فاتورة)

## Helpers مرتبطة

- `web/src/lib/technical-data.ts` — تسلسل حتمي ومقارنة بلا أثر على المحتوى
- `web/src/modules/pos-audit/rule-labels.ts` — rule key → تسمية بشرية (بدون تخمين للمجهول)
- `web/src/modules/pos-audit/event-presentation.ts` — ملخص حدث + diff حقول معروفة

## Do / Don't

- ✅ أبقِ `rule_key` و`version` كما هما في الـ API؛ غيّر العرض فقط
- ✅ Unknown key → اعرضه خاماً داخل التفاصيل التقنية أو كـ fallback للمسار
- ❌ لا تُعقّم / لا تُعدّل raw payload
- ❌ لا تفرض migration على شاشات debug/developer-only إن وُجدت
