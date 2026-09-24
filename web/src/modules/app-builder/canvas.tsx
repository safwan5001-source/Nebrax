'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { ImageOff, ShoppingCart } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatRiyal } from '@/lib/money';
import { type AppSchemaComponent } from '@/lib/app-builder';
import { presentationCssVars } from '@/modules/store-experience-builder/presentation/tokens';

/**
 * APP-BUILDER-5 — عرض تقريبي إطاري-محايد (React/Tailwind) لعقدة مخطط، لا رسم Flutter
 * حرفي (AB-11: «Builder إطاريّ فقط عند حدّ قدرة التشغيل»). قراءة فقط — لا تحرير هنا
 * (APP-BUILDER-6). كل قراءة خاصية دفاعية بنفس منطق `component_widgets.dart` الحقيقي:
 * خاصية غائبة أو بنوع خطأ تسقط لقيمة افتراضية آمنة، لا استثناء.
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

function TypeTag({ type, selected }: { type: string; selected: boolean }) {
  return (
    <span
      className={cn(
        'pointer-events-none absolute -top-2.5 start-1.5 rounded px-1.5 py-0.5 text-[10px] font-medium leading-none',
        selected ? 'bg-primary text-primary-foreground' : 'bg-surface text-muted opacity-0 group-hover:opacity-100'
      )}
    >
      {type}
    </span>
  );
}

/** كل مكوّن يُغلَّف بهذا حتى يحمل شارة النوع والتحديد بلا تكرار المنطق 15 مرة. */
function NodeFrame({
  node,
  selected,
  onSelect,
  className,
  children,
}: {
  node: AppSchemaComponent;
  selected: boolean;
  onSelect: (id: string) => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(node.id);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(node.id);
        }
      }}
      className={cn(
        'group relative cursor-pointer rounded outline-none',
        selected ? 'ring-2 ring-primary' : 'hover:ring-1 hover:ring-border',
        className
      )}
    >
      <TypeTag type={node.type} selected={selected} />
      {children}
    </div>
  );
}

function CanvasComponentNode({
  node,
  selectedId,
  onSelect,
}: {
  node: AppSchemaComponent;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const selected = node.id === selectedId;
  const children = node.children ?? [];
  const frame = (body: React.ReactNode, className?: string) => (
    <NodeFrame node={node} selected={selected} onSelect={onSelect} className={className}>
      {body}
    </NodeFrame>
  );

  switch (node.type) {
    case 'Page':
      return (
        <div className="space-y-3 p-3">
          {children.map((child) => (
            <CanvasComponentNode key={child.id} node={child} selectedId={selectedId} onSelect={onSelect} />
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
              <CanvasComponentNode key={child.id} node={child} selectedId={selectedId} onSelect={onSelect} />
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
                <CanvasComponentNode node={child} selectedId={selectedId} onSelect={onSelect} />
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
        </div>
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
              <CanvasComponentNode key={child.id} node={child} selectedId={selectedId} onSelect={onSelect} />
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
          <span className="rounded border border-border px-1.5">−</span>
          <span className="num">{value}</span>
          <span className="rounded border border-border px-1.5">+</span>
        </div>
      );
    }

    case 'AddToCart': {
      const label = stringProp(node, 'label', 'إضافة للسلة');
      return frame(
        <span className="inline-flex items-center gap-1.5 rounded bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground">
          <ShoppingCart className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
          {label}
        </span>
      );
    }

    case 'CartList':
      return frame(
        <div className="space-y-2 p-2">
          {children.length === 0 ? (
            <span className="text-xs text-muted">—</span>
          ) : (
            children.map((child) => <CanvasComponentNode key={child.id} node={child} selectedId={selectedId} onSelect={onSelect} />)
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
            'inline-block rounded px-2.5 py-1.5 text-xs font-medium',
            style === 'secondary' ? 'border border-border text-text' : 'bg-primary text-primary-foreground'
          )}
        >
          {label}
        </span>
      );
    }

    case 'NavigationTarget': {
      const label = stringProp(node, 'label');
      return frame(
        <div className="flex items-center justify-between gap-2 p-1.5 text-sm text-text">
          <span>{label || '—'}</span>
          <span aria-hidden="true" className="text-muted">‹</span>
        </div>
      );
    }

    default:
      return frame(<p className="p-1.5 text-xs text-muted">{node.type}</p>);
  }
}

/**
 * تحويل رموز مظهر محدودة (لون فقط اليوم) إلى متغيّرات CSS تلتقطها فئات
 * `bg-primary`/`text-primary-foreground` الموجودة أصلاً (`tailwind.config.ts`:
 * `var(--primary)`/`var(--primary-foreground)`) — بلا إعادة كتابة أي مكوّن.
 * نصف القطر محفوظ في `theme.tokens` ويُقارَن/يُطبَّق، لكن لا يُعاين هنا بعد:
 * `borderRadius.DEFAULT` في Tailwind قيمة ثابتة لا متغيّر (انظر وثيقة الأدلّة).
 */
function themeCssVars(tokens: Record<string, string> | undefined): React.CSSProperties {
  const primary = tokens?.primaryColor;
  if (!primary || !/^#([0-9a-fA-F]{6})$/.test(primary)) return {};
  const vars = presentationCssVars(primary, 'default');
  return { '--primary': vars['--primary'], '--primary-foreground': vars['--primary-foreground'] } as React.CSSProperties;
}

export function AppBuilderCanvas({
  root,
  device,
  locale,
  selectedId,
  onSelect,
  themeTokens,
}: {
  root: AppSchemaComponent | null;
  device: PreviewDevice;
  locale: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  themeTokens?: Record<string, string>;
}) {
  const t = useTranslations('appBuilder.builder');

  return (
    <div className="flex h-full min-h-0 flex-1 justify-center overflow-auto bg-background p-6">
      <div
        dir={locale.toLowerCase().startsWith('ar') ? 'rtl' : 'ltr'}
        style={{ width: PREVIEW_WIDTHS[device], maxWidth: '100%', ...themeCssVars(themeTokens) }}
        className="h-fit min-h-[480px] shrink-0 rounded-lg border border-border bg-surface shadow-sm"
        onClick={() => root && onSelect(root.id)}
      >
        {root ? (
          <CanvasComponentNode node={root} selectedId={selectedId} onSelect={onSelect} />
        ) : (
          <p className="p-6 text-center text-sm text-muted">{t('emptyPage')}</p>
        )}
      </div>
    </div>
  );
}
