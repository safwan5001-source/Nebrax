# معمارية الرموز (Design Tokens Architecture)

الرموز هي الطبقة الوحيدة التي تحمل قيماً حقيقية. كل شيء فوقها يشير إليها بالاسم.

## الطبقات الثلاث

```
Primitive (قيم خام: #1e40af, 0.5rem)   ← داخل globals.css فقط
        ↓
Semantic (رموز بالمعنى: --primary, --border, --positive)   ← ما تستخدمه
        ↓
Component (يستهلك الدلالية: bg-primary, border-border)      ← في الـ JSX
```

القاعدة: المكوّن يستهلك **الرمز الدلالي** عبر Tailwind، ولا يرى القيمة الخام أبداً.

## أين تُعرَّف

| الطبقة | الملف |
|---|---|
| القيم الخام + الدلالية (CSS vars) | `web/src/app/globals.css` (`:root` و`.dark`) |
| الربط بأسماء Tailwind | `web/tailwind.config.ts` |
| الخطوط | تُحمَّل في `web/src/app/layout.tsx`، وتُسمّى في `globals.css` |

## قواعد متغيّرات CSS (CSS Variable Rules)

1. كل رمز يبدأ بـ `--` ويُعرَّف مرّتين: في `:root` (فاتح) وفي `.dark` (داكن) إن اختلف.
2. الأسماء **دلالية لا وصفية**: `--primary` لا `--blue`؛ `--negative` لا `--red`.
3. القيم الخام (hex, rem) **لا تظهر إلا هنا**. أي `#hex` في مكوّن = خطأ مراجعة.
4. الرموز الدلالية الثابتة عبر الوضعين (`--positive/--negative/--warning`) تُكرَّر بنفس
   القيمة في `.dark` (وضوحاً، لا اعتماداً على التوريث).

## قواعد Tailwind (Tailwind Rules)

1. `darkMode: 'class'` — الوضع الداكن بكلاس `.dark` على `<html>` (يديره next-themes).
2. كل لون في `theme.extend.colors` يشير لمتغيّر: `primary: 'var(--primary)'`.
3. استخدم أدوات Tailwind الدلالية: `bg-primary`, `text-muted`, `border-border`, `bg-primary-soft`.
4. **ممنوع** ألوان Tailwind الافتراضية (`bg-blue-600`, `text-gray-500`) — كلها تتجاوز الرموز.
5. الخصائص المنطقية فقط: `ms/me`, `ps/pe`, `start/end`, `border-e/border-s`, `text-start/text-end`.
6. `cn()` (من `@/lib/utils`) لدمج الأصناف الشرطية.

## اصطلاح تسمية الرموز (Token Naming)

| النوع | النمط | مثال |
|---|---|---|
| سطح/خلفية | اسم الدور | `--background`, `--surface` |
| نص | مستوى الأهمية | `--text`, `--muted` |
| هوية | `primary` + تدرّج الحالة | `--primary`, `--primary-hover`, `--primary-soft` |
| دلالة مالية | المعنى | `--positive`, `--negative`, `--warning` |
| رموز مقترحة v2.0 | العائلة + المقياس | `--space-4`, `--radius-md`, `--shadow-sm`, `--z-modal`, `--ease-standard` |

> الرموز المقترحة (تباعد/ارتفاع/حركة/z-index) موثّقة في ملفات هذا المجلد، ومُرحَّلها للكود
> في `foundations/recommended-improvements.md`. حتى تُرحَّل، استخدم مكافئاتها في Tailwind الافتراضي
> كما هو موضّح في كل ملف.

## ملفات الرموز في هذا المجلد

- `color.md` — رموز الألوان (موجودة في الكود).
- `typography.md` — رموز/مقياس الطباعة.
- `spacing.md` — مقياس التباعد.
- `radius-elevation-zindex.md` — الزوايا، الارتفاع، طبقات z.
- `motion.md` — المدد ومنحنيات الحركة.
