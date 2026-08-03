# دليل الهندسة (Engineering Guidelines)

التسميات، Tailwind/CSS، اتفاقيات shadcn، وبنية الملفات — حتى يكتب الجميع نفس الكود.

## 1. اصطلاحات التسمية (Naming Conventions)

| العنصر | النمط | مثال |
|---|---|---|
| ملف مكوّن UI | kebab-case | `data-table.tsx`, `theme-toggle.tsx` |
| مكوّن React | PascalCase | `DataTable`, `PartnerDialog` |
| صفحة App Router | `page.tsx` داخل مسار | `app/(app)/partners/new/page.tsx` |
| دالة/متغيّر | camelCase | `formatRiyal`, `riyalToMinor` |
| ثابت وحدة | UPPER_SNAKE | `DURATION`, `BRAND_BULLETS` |
| مجموعة مسارات | `(name)` | `(app)`, `(pos)` |
| رمز CSS | `--kebab-semantic` | `--primary-soft`, `--positive` |
| مفتاح i18n | camelCase مجمّع | `invoiceForm.save_post` |

## 2. تسمية الرموز (Token Naming)
- **دلالي لا وصفي:** `--primary` لا `--blue`؛ `--negative` لا `--red`.
- عائلة + حالة: `--primary`, `--primary-hover`, `--primary-soft`.
- المقترحة: عائلة + مقياس (`--space-4`, `--radius-md`, `--shadow-sm`, `--z-modal`, `--dur-fast`).

## 3. قواعد CSS Variables
- تُعرَّف في `globals.css` (`:root` + `.dark`) فقط.
- لا قيم خام خارجها. أي `#hex`/`px` في مكوّن = خطأ.
- الدلالية الثابتة تُكرَّر في `.dark` صراحةً.

## 4. قواعد Tailwind
1. أدوات دلالية مربوطة بالرموز فقط: `bg-primary`, `text-muted`, `border-border`.
2. **ممنوع** ألوان Tailwind الافتراضية (`bg-blue-600`, `text-gray-500`).
3. خصائص منطقية RTL حصراً: `ms/me`, `ps/pe`, `start/end`, `border-e/s`, `text-start/end`. لا `left/right`.
4. `cn()` لدمج الأصناف الشرطية وتجاوز `className`.
5. درجات المقياس القياسي فقط (لا `p-[13px]`).
6. `darkMode: 'class'`.

## 5. اتفاقيات shadcn/ui
- **CVA** للمتغيّرات/الأحجام (`variants`, `defaultVariants`).
- **forwardRef** لأي مكوّن يغلّف عنصر HTML.
- الأصناف الأساسية داخل المكوّن؛ التخصيص عبر `className` (يُدمَج، لا يُستبدَل).
- `'use client'` للمكوّنات التفاعلية فقط.
- مكوّنات صغيرة قابلة للتركيب (Card = Card/Header/Title/Content).

## 6. بنية ملفات نظام التصميم (في الكود)
```
web/
├─ tailwind.config.ts              # ربط الرموز + الخطوط + rounded
├─ src/app/
│  ├─ globals.css                  # الرموز (فاتح/داكن) + .num + طباعة
│  ├─ layout.tsx                   # الخطوط + الاتجاه
│  └─ (app)/layout.tsx             # قشرة التطبيق
├─ src/components/
│  ├─ providers.tsx                # next-intl + next-themes + Toast
│  ├─ ui/                          # المكوّنات الأساسية (shadcn-style)
│  ├─ layout/                      # sidebar, topbar, toggles, banner
│  ├─ data-table.tsx               # DataTable
│  └─ charts/                      # رسوم SVG
└─ src/lib/
   ├─ utils.ts (cn) · money.ts · export.ts · api.ts · auth.ts
```

## 7. قواعد عامة
- **لا تكرّر مكوّناً؛** وسّع الموجود.
- **الأرقام المالية** عبر `money.ts` فقط.
- **النداءات** عبر `lib/api.ts` (Bearer + معالجة 401 + وضع Demo).
- **i18n:** لا نصّ مكتوب مباشرة؛ مفاتيح `next-intl` (مجموعتا ar/en متطابقتان دائماً).
- **التحقّق:** `npm run build` يجب أن ينجح قبل أي دمج (Web CI يفرضه).
