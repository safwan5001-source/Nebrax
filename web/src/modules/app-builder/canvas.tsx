'use client';

import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { EyeOff, FlaskConical, ImageOff, ShoppingCart } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatRiyal } from '@/lib/money';
import { registryLabel, type AppBuilderRegistries, type AppSchemaComponent } from '@/lib/app-builder';
import { presentationCssVars, radiusToken, RADIUS_PRESETS, type RadiusId } from '@/modules/store-experience-builder/presentation/tokens';
import { resolveNodeBindings } from './runtime-contract';
import { SAMPLE_RESOURCE_DATA } from './sample-resource-data';

/**
 * APP-BUILDER-5 — عرض تقريبي إطاري-محايد (React/Tailwind) لعقدة مخطط، لا رسم Flutter
 * حرفي (AB-11: «Builder إطاريّ فقط عند حدّ قدرة التشغيل»). قراءة فقط — لا تحرير هنا
 * (APP-BUILDER-6). كل قراءة خاصية دفاعية بنفس منطق `component_widgets.dart` الحقيقي:
 * خاصية غائبة أو بنوع خطأ تسقط لقيمة افتراضية آمنة، لا استثناء.
 *
 * **LIVE-PREVIEW-3** — الشجرة المعروضة فعلياً هي ناتج `resolveNodeBindings` (مطابقة
 * `binding_resolution.dart`، `./runtime-contract`) مطبَّقاً على المخطط الأصلي ببيانات
 * تجريبية (`./sample-resource-data`) — لا جلب حيّ، ولا رمز حامل متجر (قرار المالك
 * الموثَّق في `AWJ_APP_BUILDER_LIVE_RUNTIME_PREVIEW_V1.md`). العقد المولَّدة من تكرار
 * `binding.collect` تحمل معرّفات مركّبة غير موجودة في المخطط الأصلي — ولا حتى معرّف
 * القالب المُستهلَك نفسه، إذ تستبدله N نسخة. التحديد للنقر عليها يُسنَد لأقرب سلفٍ
 * معروف فعلاً في المخطط الأصلي (`knownIds`/`selectFallbackId`) بدل معرّفها الاصطناعي
 * — عملياً عقدة الربط الحاوية (`ProductList`/`CartList`) نفسها، لا القالب المختفي.
 *
 * **LIVE-PREVIEW-4** — محاذاة قدرات مدعومة فعلاً فقط، لا محاكاة قدرة غير مدعومة:
 * - **الإجراء**: مكوّن قابل للفعل (`Button`/`AddToCart`/`ProductCard`/`NavigationTarget`)
 *   بلا `action` مرفق يُعرَض معتماً (50%) — يطابق `_ActionTappable`/`onPressed: null`
 *   الحقيقيين في `component_widgets.dart`، لا افتراض أنه سيستجيب للنقر حين لا يوجد فعل.
 * - **الظهور**: `visibility` **لا تُقيَّم شرطياً هنا إطلاقاً** — عمداً. البناء الحالي
 *   لا يملك `schemaFeatures['visibility']` (مطابقاً `RuntimeCapabilities`)، فتقييمها هنا
 *   (حتى بدوال `evaluateVisibility`/`pruneInvisible` المطابقة تماماً في `./runtime-contract`)
 *   كان سيحاكي قدرةً غير موجودة فعلياً على أي جهاز حقيقي اليوم. بدلاً من ذلك: عقدة تحمل
 *   شرط ظهور تُعرَض دوماً + شارة صريحة («لم يُطبَّق بعد») — تماماً كما يبقى النشر
 *   ينجح/يفشل به فعلياً (`CompatibilityResolver`)، لا كما لو كان الشرط يعمل.
 */

export const PREVIEW_WIDTHS = { mobile: 390, tablet: 768, desktop: 1280 } as const;
export type PreviewDevice = keyof typeof PREVIEW_WIDTHS;

function stringProp(node: AppSchemaComponent, key: string, fallback = ''): string {
  const value = node.props?.[key];
  return typeof value === 'string' ? value : fallback;
}

function intProp(node: AppSchemaComponent, key: string, fallback = 0): number {
  const value = node.props?.[key];
  return typeof value === 'number' ? value : fallback;
}

function stringListProp(node: AppSchemaComponent, key: string): string[] {
  const value = node.props?.[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/** يجمع كل معرّفات عقد المخطط **الأصلي** (قبل حلّ الربط) — مرجع «ما هو حقيقي وقابل للتحرير». */
function collectIds(node: AppSchemaComponent, into: Set<string>): Set<string> {
  into.add(node.id);
  for (const child of node.children ?? []) collectIds(child, into);
  return into;
}

/** هل تحمل الشجرة عقدة ربط واحدة على الأقل — يقرّر ظهور شارة «بيانات تجريبية». */
function hasAnyBinding(node: AppSchemaComponent): boolean {
  if (node.binding) return true;
  return (node.children ?? []).some(hasAnyBinding);
}

function TypeTag({ type, label, selected }: { type: string; label: string; selected: boolean }) {
  return (
    <span
      title={type}
      className={cn(
        'pointer-events-none absolute -top-2.5 start-1.5 rounded px-1.5 py-0.5 text-[10px] font-medium leading-none',
        selected ? 'bg-primary text-primary-foreground' : 'bg-surface text-muted opacity-0 group-hover:opacity-100'
      )}
    >
      {label}
    </span>
  );
}

/**
 * LIVE-PREVIEW-4 — شارة **صريحة ودائمة الظهور** (لا تعتمد على hover كـ`TypeTag`) على
 * أي عقدة تحمل `visibility`: البناء الحالي لا يقيّم شروط الظهور إطلاقاً
 * (`RuntimeCapabilities.schemaFeatures` بلا `'visibility'`)، فالعقدة تُعرَض دوماً بصرف
 * النظر عن شرطها — هذه الشارة وحدها ما يمنع تلك الحقيقة من الاختفاء خلف عرضٍ يبدو عادياً.
 */
function UnsupportedVisibilityBadge({ label }: { label: string }) {
  return (
    <span
      title={label}
      className="pointer-events-none absolute -top-2.5 end-1.5 flex items-center gap-1 rounded bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium leading-none text-warning"
    >
      <EyeOff className="h-2.5 w-2.5" strokeWidth={2} aria-hidden="true" />
      {label}
    </span>
  );
}

/**
 * كل مكوّن يُغلَّف بهذا حتى يحمل شارة النوع والتحديد بلا تكرار المنطق 15 مرة.
 * شارة النوع أداة بناء (Builder chrome) لا محتوى تجربة معاينة — تتبع لغة
 * واجهة أَوْج الفعلية (`useLocale()`)، لا مفتاح `locale`/`previewLocale`
 * المُمرَّر لعرض المحتوى نفسه (اتجاه RTL/LTR)، تماماً كشجرة الطبقات.
 */
function NodeFrame({
  node,
  selectId,
  selected,
  onSelect,
  className,
  children,
  registries,
}: {
  node: AppSchemaComponent;
  /** المعرّف الذي يُرسَل فعلياً إلى `onSelect` — معرّف العقدة نفسها إن كانت حقيقية (موجودة
   * في المخطط الأصلي)، أو أقرب سلفٍ حقيقي إن كانت نسخة مولَّدة من تكرار `binding.collect`. */
  selectId: string;
  selected: boolean;
  onSelect: (id: string) => void;
  className?: string;
  children: React.ReactNode;
  registries: AppBuilderRegistries | null;
}) {
  const uiLocale = useLocale();
  const t = useTranslations('appBuilder.builder');
  const definition = registries?.components[node.type];
  const typeLabel = definition ? registryLabel(definition.label, uiLocale) : node.type;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(selectId);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(selectId);
        }
      }}
      className={cn(
        'group relative cursor-pointer rounded outline-none',
        selected ? 'ring-2 ring-primary' : 'hover:ring-1 hover:ring-border',
        className
      )}
    >
      <TypeTag type={node.type} label={typeLabel} selected={selected} />
      {node.visibility ? <UnsupportedVisibilityBadge label={t('visibilityUnsupportedBadge')} /> : null}
      {children}
    </div>
  );
}

function CanvasComponentNode({
  node,
  selectedId,
  onSelect,
  registries,
  knownIds,
  selectFallbackId,
}: {
  node: AppSchemaComponent;
  selectedId: string | null;
  onSelect: (id: string) => void;
  registries: AppBuilderRegistries | null;
  /** معرّفات المخطط الأصلي — عقدة معرّفها خارج هذه المجموعة نسخةٌ مولَّدة من تكرار `binding.collect`. */
  knownIds: Set<string>;
  /** أقرب سلفٍ معروف لهذه العقدة، تُسنَد إليه التحديدات الصادرة من نسخ مولَّدة. */
  selectFallbackId: string;
}) {
  const isKnown = knownIds.has(node.id);
  const effectiveSelectId = isKnown ? node.id : selectFallbackId;
  const childFallbackId = isKnown ? node.id : selectFallbackId;
  const selected = isKnown && node.id === selectedId;
  const children = node.children ?? [];
  const frame = (body: React.ReactNode, className?: string) => (
    <NodeFrame node={node} selectId={effectiveSelectId} selected={selected} onSelect={onSelect} className={className} registries={registries}>
      {body}
    </NodeFrame>
  );

  switch (node.type) {
    case 'Page':
      return (
        <div className="space-y-3 p-3">
          {children.map((child) => (
            <CanvasComponentNode key={child.id} node={child} selectedId={selectedId} onSelect={onSelect} registries={registries} knownIds={knownIds} selectFallbackId={childFallbackId} />
          ))}
        </div>
      );

    case 'Section': {
      const title = stringProp(node, 'title');
      return frame(
        <div className="space-y-2 border-t-2 border-border p-2">
          {title ? <p className="text-sm font-semibold text-text">{title}</p> : null}
          <div className="space-y-2">
            {children.map((child) => (
              <CanvasComponentNode key={child.id} node={child} selectedId={selectedId} onSelect={onSelect} registries={registries} knownIds={knownIds} selectFallbackId={childFallbackId} />
            ))}
          </div>
        </div>
      );
    }

    case 'Text': {
      const text = stringProp(node, 'text');
      const style = stringProp(node, 'style', 'body');
      return frame(
        <p
          className={cn(
            'p-1.5',
            style === 'title' ? 'text-lg font-semibold text-text' : style === 'caption' ? 'text-xs text-muted' : 'text-sm text-text'
          )}
        >
          {text || '—'}
        </p>
      );
    }

    case 'Image': {
      const url = stringProp(node, 'url');
      return frame(
        <div className="flex aspect-video items-center justify-center bg-background text-muted">
          {url.startsWith('https://') ? (
            <span className="truncate px-2 text-xs" dir="ltr">{url}</span>
          ) : (
            <ImageOff className="h-6 w-6" strokeWidth={1.6} aria-hidden="true" />
          )}
        </div>
      );
    }

    case 'ProductList':
      return frame(
        <div className="flex gap-2 overflow-x-auto p-2">
          {children.length === 0 ? (
            <span className="text-xs text-muted">—</span>
          ) : (
            children.map((child) => (
              <div key={child.id} className="w-32 shrink-0">
                <CanvasComponentNode node={child} selectedId={selectedId} onSelect={onSelect} registries={registries} knownIds={knownIds} selectFallbackId={childFallbackId} />
              </div>
            ))
          )}
        </div>
      );

    case 'ProductCard': {
      const title = stringProp(node, 'title');
      const amountMinor = intProp(node, 'amountMinor');
      return frame(
        <div className="space-y-1 border border-border p-2">
          <div className="flex aspect-square items-center justify-center bg-background text-muted">
            <ImageOff className="h-5 w-5" strokeWidth={1.6} aria-hidden="true" />
          </div>
          <p className="truncate text-xs text-text">{title || '—'}</p>
          <p className="num text-xs font-semibold text-text">{formatRiyal(amountMinor / 100)}</p>
        </div>,
        node.action ? undefined : 'opacity-50'
      );
    }

    case 'ProductDetail': {
      const title = stringProp(node, 'title');
      const description = stringProp(node, 'description');
      const amountMinor = intProp(node, 'amountMinor');
      return frame(
        <div className="space-y-2 p-2">
          <div className="flex aspect-video items-center justify-center bg-background text-muted">
            <ImageOff className="h-6 w-6" strokeWidth={1.6} aria-hidden="true" />
          </div>
          <p className="font-semibold text-text">{title || '—'}</p>
          <p className="num text-sm font-semibold text-text">{formatRiyal(amountMinor / 100)}</p>
          {description ? <p className="text-sm text-muted">{description}</p> : null}
          <div className="space-y-2 border-t border-border pt-2">
            {children.map((child) => (
              <CanvasComponentNode key={child.id} node={child} selectedId={selectedId} onSelect={onSelect} registries={registries} knownIds={knownIds} selectFallbackId={childFallbackId} />
            ))}
          </div>
        </div>
      );
    }

    case 'Price': {
      const amountMinor = intProp(node, 'amountMinor');
      return frame(<p className="num p-1.5 text-sm font-semibold text-text">{formatRiyal(amountMinor / 100)}</p>);
    }

    case 'VariantSelector': {
      const options = stringListProp(node, 'options');
      return frame(
        <div className="flex flex-wrap gap-1.5 p-1.5">
          {options.length === 0 ? (
            <span className="text-xs text-muted">—</span>
          ) : (
            options.map((option) => (
              <span key={option} className="rounded-full border border-border px-2 py-0.5 text-xs text-text">
                {option}
              </span>
            ))
          )}
        </div>
      );
    }

    case 'Quantity': {
      const value = intProp(node, 'value', 1);
      return frame(
        <div className="flex w-fit items-center gap-2 p-1.5 text-sm text-text">
          <span className="rounded-canvas border border-border px-1.5">−</span>
          <span className="num">{value}</span>
          <span className="rounded-canvas border border-border px-1.5">+</span>
        </div>
      );
    }

    case 'AddToCart': {
      const label = stringProp(node, 'label', 'إضافة للسلة');
      return frame(
        <span className="inline-flex items-center gap-1.5 rounded-canvas bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground">
          <ShoppingCart className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
          {label}
        </span>,
        node.action ? undefined : 'opacity-50'
      );
    }

    case 'CartList':
      return frame(
        <div className="space-y-2 p-2">
          {children.length === 0 ? (
            <span className="text-xs text-muted">—</span>
          ) : (
            children.map((child) => <CanvasComponentNode key={child.id} node={child} selectedId={selectedId} onSelect={onSelect} registries={registries} knownIds={knownIds} selectFallbackId={childFallbackId} />)
          )}
        </div>
      );

    case 'CartSummary': {
      const itemCount = intProp(node, 'itemCount');
      const subtotalAmountMinor = intProp(node, 'subtotalAmountMinor');
      return frame(
        <div className="flex items-center justify-between gap-3 border border-border p-2 text-sm">
          <span className="text-text">{itemCount} عنصر</span>
          <span className="num font-semibold text-text">{formatRiyal(subtotalAmountMinor / 100)}</span>
        </div>
      );
    }

    case 'Button': {
      const label = stringProp(node, 'label', 'زر');
      const style = stringProp(node, 'style', 'primary');
      return frame(
        <span
          className={cn(
            'inline-block rounded-canvas px-2.5 py-1.5 text-xs font-medium',
            style === 'secondary' ? 'border border-border text-text' : 'bg-primary text-primary-foreground'
          )}
        >
          {label}
        </span>,
        node.action ? undefined : 'opacity-50'
      );
    }

    case 'NavigationTarget': {
      const label = stringProp(node, 'label');
      return frame(
        <div className="flex items-center justify-between gap-2 p-1.5 text-sm text-text">
          <span>{label || '—'}</span>
          <span aria-hidden="true" className="text-muted">‹</span>
        </div>,
        node.action ? undefined : 'opacity-50'
      );
    }

    default:
      return frame(<p className="p-1.5 text-xs text-muted">{node.type}</p>);
  }
}

/**
 * تحويل رموز مظهر محدودة (لون + نصف قطر) إلى متغيّرات CSS تلتقطها فئات
 * `bg-primary`/`text-primary-foreground` الموجودة أصلاً (`tailwind.config.ts`:
 * `var(--primary)`/`var(--primary-foreground)`) وفئة `rounded-canvas` الجديدة
 * (`var(--canvas-radius)`) — بلا إعادة كتابة أي مكوّن. **مغلَق الآن** (كان
 * فجوة موثَّقة في وثيقة الأدلّة §11 — APP-BUILDER-22): `borderRadius.DEFAULT`
 * في Tailwind يبقى قيمة ثابتة عمداً (تستعملها فئة `rounded` المجرّدة في كل
 * الواجهة خارج الـBuilder)، فأُضيف نطاقٌ منفصل `canvas` بدل تعديله.
 */
function themeCssVars(tokens: Record<string, string> | undefined): React.CSSProperties {
  const primary = tokens?.primaryColor;
  const radiusId = (RADIUS_PRESETS.some((preset) => preset.id === tokens?.radius) ? tokens!.radius : 'default') as RadiusId;
  const vars: Record<string, string> = { '--canvas-radius': radiusToken(radiusId) };
  if (primary && /^#([0-9a-fA-F]{6})$/.test(primary)) {
    const presentationVars = presentationCssVars(primary, radiusId);
    vars['--primary'] = presentationVars['--primary'];
    vars['--primary-foreground'] = presentationVars['--primary-foreground'];
  }
  return vars as React.CSSProperties;
}

export function AppBuilderCanvas({
  root,
  device,
  locale,
  selectedId,
  onSelect,
  themeTokens,
  registries = null,
}: {
  root: AppSchemaComponent | null;
  device: PreviewDevice;
  locale: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  themeTokens?: Record<string, string>;
  registries?: AppBuilderRegistries | null;
}) {
  const t = useTranslations('appBuilder.builder');

  // LIVE-PREVIEW-3: الشجرة المعروضة فعلياً هي ناتج حلّ الربط، لا المخطط الخام —
  // `knownIds` يبقى مرجع المخطط الأصلي لأن التحديد للتحرير يستهدف القالب دوماً لا
  // نسخة مولَّدة (انظر تعليق الملف الرأسي).
  const knownIds = React.useMemo(() => (root ? collectIds(root, new Set()) : new Set<string>()), [root]);
  const resolvedRoot = React.useMemo(() => (root ? resolveNodeBindings(root, SAMPLE_RESOURCE_DATA) : null), [root]);
  const showSampleDataBanner = React.useMemo(() => (root ? hasAnyBinding(root) : false), [root]);

  return (
    <div className="flex h-full min-h-0 flex-1 justify-center overflow-auto bg-background p-6">
      <div
        dir={locale.toLowerCase().startsWith('ar') ? 'rtl' : 'ltr'}
        style={{ width: PREVIEW_WIDTHS[device], maxWidth: '100%', ...themeCssVars(themeTokens) }}
        className="h-fit min-h-[480px] shrink-0 overflow-hidden rounded-lg border border-border bg-surface shadow-sm"
        onClick={() => root && onSelect(root.id)}
      >
        {showSampleDataBanner ? (
          <div className="flex items-center gap-1.5 border-b border-border bg-primary-soft px-3 py-1.5 text-[11px] font-medium text-primary">
            <FlaskConical className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} aria-hidden="true" />
            <span>{t('sampleDataBanner')}</span>
          </div>
        ) : null}
        {resolvedRoot ? (
          <CanvasComponentNode
            node={resolvedRoot}
            selectedId={selectedId}
            onSelect={onSelect}
            registries={registries}
            knownIds={knownIds}
            selectFallbackId={resolvedRoot.id}
          />
        ) : (
          <p className="p-6 text-center text-sm text-muted">{t('emptyPage')}</p>
        )}
      </div>
    </div>
  );
}
