'use client';

import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import {
  createComponentFromDefinition, isVisibilityLeaf, registryLabel,
  type AppSchemaActionRef, type AppSchemaBinding, type AppSchemaComponent, type AppBuilderRegistries,
  type RegistryActionParamDefinition, type RegistryPropDefinition, type RegistryResourceDefinition,
  type RegistryVisibilityOperator, type VisibilityLeaf, type VisibilityNode, type VisibilityScalar,
} from '@/lib/app-builder';

/**
 * APP-BUILDER-6 — لوحة خصائص **قابلة للتحرير**، مبنيّة على شكل APP-BUILDER-5 للقراءة
 * فقط حرفياً (نفس الكثافة والتخطيط — القيمة فقط صارت تفاعلية)، مصدرها نفسه
 * `ComponentRegistry`/`ActionRegistry`. انظر `APP-BUILDER-6-UX-EVIDENCE-PASS.md`.
 */

/** مفتاح الترجمة لإشارة ظهور: النقطة في معرّف الإشارة (`cart.itemCount`) تُقرأ تداخلاً في next-intl (INVALID_KEY)، فتُستبدل بشرطة سفلية. */
export const signalKey = (signal: string): string => signal.replace(/\./g, '_');

const MULTILINE_PROP_KEYS = new Set(['text', 'description']);

function PropField({
  definition,
  value,
  onChange,
  id,
  labelId,
  labelText,
}: {
  definition: RegistryPropDefinition;
  value: unknown;
  onChange: (next: unknown) => void;
  /** يربط `<label htmlFor>` بالتحكم (UX-03). */
  id: string;
  labelId: string;
  /** نص التسمية — يبني منه الاسم المُتاح لعناصر القائمة. */
  labelText: string;
}) {
  const t = useTranslations('appBuilder.builder');
  if (definition.enum_values && definition.enum_values.length > 0) {
    const current = typeof value === 'string' ? value : '';
    return (
      <Select id={id} value={current} onChange={(event) => onChange(event.target.value)} className="h-8 text-xs">
        {definition.enum_values.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </Select>
    );
  }

  switch (definition.type) {
    case 'integer': {
      const current = typeof value === 'number' ? value : '';
      return (
        <Input
          id={id}
          type="number"
          className="h-8 text-xs"
          value={current}
          onChange={(event) => onChange(event.target.value === '' ? undefined : Number(event.target.value))}
        />
      );
    }
    case 'amountMinor': {
      const minor = typeof value === 'number' ? value : 0;
      return (
        <Input
          id={id}
          type="number"
          step="0.01"
          className="h-8 text-xs"
          value={minor / 100}
          onChange={(event) => {
            const major = Number(event.target.value);
            onChange(Number.isFinite(major) ? Math.round(major * 100) : 0);
          }}
        />
      );
    }
    case 'stringList': {
      const items = Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
      return (
        <div className="space-y-1" role="group" aria-labelledby={labelId}>
          {items.map((item, index) => (
            <div key={index} className="flex items-center gap-1">
              <Input
                className="h-8 text-xs"
                aria-label={t('fieldA11y.itemName', { label: labelText, n: index + 1 })}
                value={item}
                onChange={(event) => {
                  const next = [...items];
                  next[index] = event.target.value;
                  onChange(next);
                }}
              />
              <button
                type="button"
                aria-label={t('fieldA11y.removeItem', { label: labelText, n: index + 1 })}
                onClick={() => onChange(items.filter((_, i) => i !== index))}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-muted hover:bg-primary-soft hover:text-primary"
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden="true" />
              </button>
            </div>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            aria-label={t('fieldA11y.addItem', { label: labelText })}
            onClick={() => onChange([...items, ''])}
          >
            <span aria-hidden="true">+</span>
          </Button>
        </div>
      );
    }
    case 'assetUrl': {
      const current = typeof value === 'string' ? value : '';
      return (
        <Input
          id={id}
          type="url"
          dir="ltr"
          className="h-8 text-xs"
          placeholder="https://"
          value={current}
          onChange={(event) => onChange(event.target.value)}
        />
      );
    }
    default: {
      const current = typeof value === 'string' ? value : '';
      if (MULTILINE_PROP_KEYS.has(definition.key)) {
        return <Textarea id={id} className="min-h-16 text-xs" value={current} onChange={(event) => onChange(event.target.value)} />;
      }
      return <Input id={id} className="h-8 text-xs" value={current} onChange={(event) => onChange(event.target.value)} />;
    }
  }
}

function PropRow({
  definition,
  value,
  onChange,
  locale,
}: {
  definition: RegistryPropDefinition;
  value: unknown;
  onChange: (next: unknown) => void;
  locale: string;
}) {
  const id = React.useId();
  const labelId = `${id}-label`;
  const labelText = registryLabel(definition.label, locale);
  // قائمة النصوص تحمل عدة تحكمات فلا يربطها `for` واحد: تسمية عادية + مجموعة `aria-labelledby`.
  const isList = definition.type === 'stringList' && !(definition.enum_values && definition.enum_values.length > 0);
  const labelContent = (
    <>
      {labelText}
      {definition.required ? <span className="text-negative"> *</span> : null}
    </>
  );
  return (
    <div className="space-y-1 border-b border-border py-2 last:border-0">
      {isList ? (
        <span id={labelId} className="block text-xs font-medium text-text" title={definition.key}>{labelContent}</span>
      ) : (
        <label id={labelId} htmlFor={id} className="block text-xs font-medium text-text" title={definition.key}>{labelContent}</label>
      )}
      <PropField definition={definition} value={value} onChange={onChange} id={id} labelId={labelId} labelText={labelText} />
    </div>
  );
}

function ActionParamField({
  definition,
  value,
  onChange,
  pageIds,
  t,
  id,
}: {
  id: string;
  definition: RegistryActionParamDefinition;
  value: unknown;
  onChange: (next: unknown) => void;
  pageIds?: string[];
  t: ReturnType<typeof useTranslations>;
}) {
  // APP-BUILDER-9 — `navigate.pageId` وحده يُعرض منتقياً من صفحات المخطط الحقيقية
  // (`pageIds` مُمرَّرة فقط لهذا المعامل تحديداً، انظر مكان الاستدعاء) بدل حقل نصّ
  // حرّ: لا طبقة تتحقّق مرجعية `pageId` بغياب صفحة مطابقة اليوم — مرجع ميت كان
  // يُكتشف وقت تشغيل التطبيق الأصلي فقط.
  if (pageIds) {
    const current = typeof value === 'string' ? value : '';
    return (
      <Select id={id} value={current} onChange={(event) => onChange(event.target.value)} className="h-8 text-xs">
        <option value="">{t('pages.pickerPlaceholder')}</option>
        {pageIds.map((pageId) => (
          <option key={pageId} value={pageId}>{pageId}</option>
        ))}
      </Select>
    );
  }
  if (definition.type === 'integer') {
    const current = typeof value === 'number' ? value : '';
    return (
      <Input
        id={id}
        type="number"
        min={definition.min_value ?? undefined}
        className="h-8 text-xs"
        value={current}
        onChange={(event) => onChange(event.target.value === '' ? undefined : Number(event.target.value))}
      />
    );
  }
  const current = typeof value === 'string' ? value : '';
  return <Input id={id} className="h-8 text-xs" value={current} onChange={(event) => onChange(event.target.value)} />;
}

function ActionParamRow({
  definition,
  value,
  onChange,
  pageIds,
  t,
  locale,
}: {
  definition: RegistryActionParamDefinition;
  value: unknown;
  onChange: (next: unknown) => void;
  pageIds?: string[];
  t: ReturnType<typeof useTranslations>;
  locale: string;
}) {
  const id = React.useId();
  return (
    <div className="space-y-1 border-b border-border py-2 last:border-0">
      <label htmlFor={id} className="block text-xs font-medium text-text" title={definition.key}>
        {registryLabel(definition.label, locale)}
        {definition.required ? <span className="text-negative"> *</span> : null}
      </label>
      <ActionParamField id={id} definition={definition} value={value} onChange={onChange} pageIds={pageIds} t={t} />
    </div>
  );
}

// ── Binding editor (APP-BUILDER-15) ──────────────────────────────────────────
// شكل `binding` نفسه مقفل تركيبياً في `AppSchemaParser` (لا نص حرّ، لا تعبير) —
// هذا المحرِّر أضيق من ذلك عمداً في نقطة واحدة: يستبعد `category_id` من واجهة
// الترشيح رغم كونه مفتاحاً صحيحاً بنيوياً، لأن قيمته الوحيدة المقصودة
// (`$route.categoryId`) مرجع سياق تنقّل لا وجود فعلياً له في أيّ مخطط/تشغيل
// اليوم (`DataResourceRegistry`'s own note) — لا يخترع هذا المحرِّر آلية سياق
// لم تُبنَ بعد؛ يُترَك الحقل قابلاً للربط لاحقاً حين تُبنى (مهمة منفصلة).
const UNRESOLVABLE_QUERY_KEYS = new Set(['category_id']);

/** ترتيبات لها تسمية بشرية في الرسائل؛ ما عداها يُعرض بمفتاحه الخام. */
const KNOWN_SORT_KEYS = new Set(['name', 'sale_price', 'created_at', 'popularity']);

function BindingEditor({
  binding,
  bindableResourceIds,
  resources,
  ownProps,
  onChange,
  t,
}: {
  binding: AppSchemaBinding | undefined;
  bindableResourceIds: string[];
  resources: Record<string, RegistryResourceDefinition>;
  ownProps: RegistryPropDefinition[];
  onChange: (next: AppSchemaBinding | undefined) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const resourceId = binding?.resource ?? '';
  const resource = resourceId ? resources[resourceId] : undefined;
  const fieldId = React.useId();
  const searchId = `${fieldId}-search`;
  const sortId = `${fieldId}-sort`;

  function setQuery(patch: Record<string, unknown>) {
    if (!binding) return;
    const nextQuery: Record<string, unknown> = { ...binding.query, ...patch };
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === '') delete nextQuery[key];
    }
    onChange({ ...binding, query: Object.keys(nextQuery).length > 0 ? nextQuery : undefined });
  }

  function setItemProp(propKey: string, fieldPath: string) {
    if (!binding) return;
    const nextItemProps: Record<string, string> = { ...binding.itemProps };
    if (fieldPath) nextItemProps[propKey] = fieldPath;
    else delete nextItemProps[propKey];
    onChange({ ...binding, itemProps: Object.keys(nextItemProps).length > 0 ? nextItemProps : undefined });
  }

  const filterParams = (resource?.query_params ?? []).filter(
    (param) => param.kind === 'filter' && !UNRESOLVABLE_QUERY_KEYS.has(param.key)
  );
  const sortParams = (resource?.query_params ?? []).filter((param) => param.kind === 'sort');
  const hasSearchFilter = filterParams.some((param) => param.key === 'search');

  const currentSortRaw = typeof binding?.query?.sort === 'string' ? binding.query.sort : '';
  const currentSortDesc = currentSortRaw.startsWith('-');
  const currentSortKey = currentSortDesc ? currentSortRaw.slice(1) : currentSortRaw;

  return (
    <div className="border-t border-border pt-3">
      <p className="mb-1 text-xs font-medium text-muted">{t('binding.title')}</p>
      <Select
        value={resourceId}
        onChange={(event) => onChange(event.target.value ? { resource: event.target.value } : undefined)}
        className="h-8 text-xs"
      >
        <option value="">{t('binding.noneOption')}</option>
        {bindableResourceIds.map((id) => (
          <option key={id} value={id}>{id}</option>
        ))}
      </Select>

      {resource ? (
        <div className="mt-2 space-y-3">
          <p className="text-[11px] leading-relaxed text-muted">{t('binding.runtimeNote')}</p>

          {hasSearchFilter || sortParams.length > 0 ? (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted">{t('binding.queryTitle')}</p>
              {hasSearchFilter ? (
                <div>
                  <label htmlFor={searchId} className="mb-1 block text-[11px] text-muted">{t('binding.searchLabel')}</label>
                  <Input
                    id={searchId}
                    className="h-8 text-xs"
                    placeholder={t('binding.searchPlaceholder')}
                    value={typeof binding?.query?.search === 'string' ? binding.query.search : ''}
                    onChange={(event) => setQuery({ search: event.target.value || undefined })}
                  />
                </div>
              ) : null}
              {sortParams.length > 0 ? (
                <div>
                  <label htmlFor={sortId} className="mb-1 block text-[11px] text-muted">{t('binding.sortLabel')}</label>
                  <div className="flex items-center gap-1.5">
                    <Select
                      id={sortId}
                      className="h-8 flex-1 text-xs"
                      value={currentSortKey}
                      onChange={(event) => {
                        const key = event.target.value;
                        setQuery({ sort: key ? (currentSortDesc ? `-${key}` : key) : undefined });
                      }}
                    >
                      <option value="">{t('binding.sortNoneOption')}</option>
                      {sortParams.map((param) => (
                        <option key={param.key} value={param.key}>{KNOWN_SORT_KEYS.has(param.key) ? t(`binding.sortOption.${param.key}`) : param.key}</option>
                      ))}
                    </Select>
                    {currentSortKey ? (
                      <Select
                        aria-label={t('binding.sortDirectionLabel')}
                        className="h-8 w-28 shrink-0 text-xs"
                        value={currentSortDesc ? 'desc' : 'asc'}
                        onChange={(event) => setQuery({ sort: event.target.value === 'desc' ? `-${currentSortKey}` : currentSortKey })}
                      >
                        <option value="asc">{t('binding.sortDirectionAscending')}</option>
                        <option value="desc">{t('binding.sortDirectionDescending')}</option>
                      </Select>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {ownProps.length > 0 && resource.fields.length > 0 ? (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted">{t('binding.mappingTitle')}</p>
              <p className="text-[11px] text-muted">{t('binding.mappingHint')}</p>
              {ownProps.map((prop) => (
                <div key={prop.key} className="flex items-center gap-1.5">
                  <span className="w-24 shrink-0 truncate text-xs text-text">{prop.key}</span>
                  <Select
                    className="h-8 flex-1 text-xs"
                    value={binding?.itemProps?.[prop.key] ?? ''}
                    onChange={(event) => setItemProp(prop.key, event.target.value)}
                  >
                    <option value="">{t('binding.mappingFieldPlaceholder')}</option>
                    {resource.fields.map((field) => (
                      <option key={field.key} value={field.key}>{field.key}</option>
                    ))}
                  </Select>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ── Visibility editor (APP-BUILDER-15, deferred from APP-BUILDER-16) ────────
// المحرِّر يعرض ويحرِّر شكلاً **مسطّحاً** فقط — ورقة واحدة، أو مجموعة أوراق
// بمُجمِّع واحد (`all`/`any`) بلا تعشيش — وهو ما يغطّي كل استعمال واقعي معقول
// (`ADR-01`: شجرة شروط مغلقة ومكتوبة، لا محرّك تعابير). شرطٌ وصل عبر الـ API
// بمُجمِّعات متداخلة (خارج ما يُنتجه هذا المحرِّر نفسه) يُعرَض كحالة "معقّدة"
// للقراءة فقط + زر إعادة ضبط — لا محاولة تسطيحه تخميناً.
type FlatVisibility =
  | { kind: 'always' }
  | { kind: 'flat'; combinator: 'all' | 'any' | null; leaves: VisibilityLeaf[] }
  | { kind: 'complex' };

function flattenVisibility(node: VisibilityNode | undefined): FlatVisibility {
  if (!node) return { kind: 'always' };
  if (isVisibilityLeaf(node)) return { kind: 'flat', combinator: null, leaves: [node] };
  const combinator: 'all' | 'any' = 'all' in node ? 'all' : 'any';
  const branches = 'all' in node ? node.all : node.any;
  if (branches.length === 0 || !branches.every(isVisibilityLeaf)) return { kind: 'complex' };
  return { kind: 'flat', combinator, leaves: branches as VisibilityLeaf[] };
}

function buildVisibility(combinator: 'all' | 'any', leaves: VisibilityLeaf[]): VisibilityNode | undefined {
  if (leaves.length === 0) return undefined;
  if (leaves.length === 1) return leaves[0];
  return combinator === 'any' ? { any: leaves } : { all: leaves };
}

function VisibilityEditor({
  visibility,
  signals,
  operators,
  onChange,
  t,
}: {
  visibility: VisibilityNode | undefined;
  signals: string[];
  operators: RegistryVisibilityOperator[];
  onChange: (next: VisibilityNode | undefined) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const flat = flattenVisibility(visibility);
  const operatorByType = new Map(operators.map((op) => [op.type, op]));

  if (flat.kind === 'complex') {
    return (
      <div className="border-t border-border pt-3">
        <p className="mb-1 text-xs font-medium text-muted">{t('visibility.title')}</p>
        <p className="mb-2 text-[11px] leading-relaxed text-muted">{t('visibility.unsupportedShape')}</p>
        <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => onChange(undefined)}>
          {t('visibility.reset')}
        </Button>
      </div>
    );
  }

  const combinator = flat.kind === 'flat' ? flat.combinator ?? 'all' : 'all';
  const leaves = flat.kind === 'flat' ? flat.leaves : [];

  function updateLeaves(nextLeaves: VisibilityLeaf[], nextCombinator: 'all' | 'any' = combinator) {
    onChange(buildVisibility(nextCombinator, nextLeaves));
  }

  function updateLeaf(index: number, patch: Partial<VisibilityLeaf>) {
    const next = [...leaves];
    next[index] = { ...next[index], ...patch };
    updateLeaves(next);
  }

  function addLeaf() {
    updateLeaves([...leaves, { signal: signals[0] ?? '', operator: operators[0]?.type ?? '' }]);
  }

  return (
    <div className="border-t border-border pt-3">
      <p className="mb-1 text-xs font-medium text-muted">{t('visibility.title')}</p>

      <Select
        className="mb-2 h-8 text-xs"
        value={leaves.length === 0 ? '' : combinator}
        onChange={(event) => {
          const value = event.target.value;
          if (!value) {
            onChange(undefined);
            return;
          }
          const seedLeaves = leaves.length > 0 ? leaves : [{ signal: signals[0] ?? '', operator: operators[0]?.type ?? '' }];
          updateLeaves(seedLeaves, value as 'all' | 'any');
        }}
      >
        <option value="">{t('visibility.alwaysOption')}</option>
        <option value="all">{t('visibility.allOption')}</option>
        <option value="any">{t('visibility.anyOption')}</option>
      </Select>

      {leaves.length > 0 ? (
        <div className="space-y-2">
          <p className="text-[11px] leading-relaxed text-muted">{t('visibility.runtimeNote')}</p>
          {leaves.map((leaf, index) => {
            const arity = operatorByType.get(leaf.operator)?.value_arity ?? 'single';
            return (
              <div key={index} className="space-y-1 rounded border border-border p-2">
                <div className="flex items-center gap-1">
                  <Select
                    className="h-8 flex-1 text-xs"
                    aria-label={t('visibility.leaf.signal', { n: index + 1 })}
                    value={leaf.signal}
                    onChange={(event) => updateLeaf(index, { signal: event.target.value })}
                  >
                    <option value="" disabled>{t('visibility.signalPlaceholder')}</option>
                    {signals.map((signal) => (
                      <option key={signal} value={signal}>{t(`visibility.signalOption.${signalKey(signal)}`)}</option>
                    ))}
                  </Select>
                  <button
                    type="button"
                    aria-label={t('visibility.leaf.remove', { n: index + 1 })}
                    onClick={() => updateLeaves(leaves.filter((_, i) => i !== index))}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-muted hover:bg-primary-soft hover:text-primary"
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden="true" />
                  </button>
                </div>
                <Select
                  className="h-8 text-xs"
                  aria-label={t('visibility.leaf.operator', { n: index + 1 })}
                  value={leaf.operator}
                  onChange={(event) => {
                    const nextOperator = event.target.value;
                    const nextArity = operatorByType.get(nextOperator)?.value_arity ?? 'single';
                    updateLeaf(index, nextArity === arity ? { operator: nextOperator } : { operator: nextOperator, value: undefined });
                  }}
                >
                  <option value="" disabled>{t('visibility.operatorPlaceholder')}</option>
                  {operators.map((op) => (
                    <option key={op.type} value={op.type}>{t(`visibility.operatorOption.${op.type}`)}</option>
                  ))}
                </Select>
                {arity === 'none' ? null : arity === 'list' ? (
                  <Input
                    className="h-8 text-xs"
                    aria-label={t('visibility.leaf.value', { n: index + 1 })}
                    placeholder={t('visibility.valueListPlaceholder')}
                    value={Array.isArray(leaf.value) ? leaf.value.join(', ') : ''}
                    onChange={(event) =>
                      updateLeaf(index, {
                        value: event.target.value.split(',').map((v) => v.trim()).filter((v) => v !== '') as VisibilityScalar[],
                      })
                    }
                  />
                ) : (
                  <Input
                    className="h-8 text-xs"
                    type={leaf.signal === 'cart.itemCount' ? 'number' : 'text'}
                    aria-label={t('visibility.leaf.value', { n: index + 1 })}
                    placeholder={t('visibility.valuePlaceholder')}
                    value={typeof leaf.value === 'string' || typeof leaf.value === 'number' ? leaf.value : ''}
                    onChange={(event) => {
                      const raw = event.target.value;
                      if (leaf.signal === 'cart.itemCount') {
                        updateLeaf(index, { value: raw === '' ? undefined : Number(raw) });
                      } else {
                        updateLeaf(index, { value: raw });
                      }
                    }}
                  />
                )}
              </div>
            );
          })}
          <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={addLeaf}>
            {t('visibility.addCondition')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function Inspector({
  node,
  registries,
  pageIds,
  onChange,
  onAddChild,
  onRemove,
  canRemove,
  mode = 'advanced',
}: {
  mode?: 'easy' | 'advanced';
  node: AppSchemaComponent | null;
  registries: AppBuilderRegistries | null;
  pageIds: string[];
  onChange: (next: AppSchemaComponent) => void;
  onAddChild: (newNode: AppSchemaComponent) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const t = useTranslations('appBuilder.builder');
  const locale = useLocale();
  const [addType, setAddType] = React.useState<string>('');

  if (!node) {
    return <p className="px-3 py-6 text-center text-xs text-muted">{t('inspectorEmpty')}</p>;
  }

  const definition = registries?.components[node.type];
  if (!definition) {
    return <p className="px-3 py-6 text-center text-xs text-muted">{t('inspectorUnknownType', { type: node.type })}</p>;
  }

  const actionDefinition = node.action ? registries?.actions[node.action.type] : undefined;
  const actionTypeOptions = registries ? Object.keys(registries.actions) : [];
  // AD-12: الأنواع المسموح تضمينها تحت هذا المكوّن من السجل (الخادم يفرضها أيضاً)؛ خادم أقدم بلا القاعدة ⇒ كل نوع عدا Page.
  const componentTypeOptions = registries
    ? (definition.allowed_children ?? Object.keys(registries.components).filter((type) => type !== 'Page')).filter((type) => registries.components[type])
    : [];
  // الوضع السهل يخفي الربط وشرط الظهور وإضافة الأبناء (تبقى قيمها في المسودة كما هي ويعرضها المتقدم) — مواصفة V2 §8.
  const advancedOnly = mode === 'advanced';
  const canAddChild = advancedOnly && definition.children_rule.kind === 'unboundedAny';
  const injectedParams = new Set(definition.injected_runtime_action_params);

  function setProp(key: string, value: unknown) {
    onChange({ ...node!, props: { ...node!.props, [key]: value } });
  }

  function attachAction(type: string) {
    if (!type) {
      const { action: _dropped, ...rest } = node!;
      onChange(rest);
      return;
    }
    const actionDef = registries?.actions[type];
    const params: Record<string, unknown> = {};
    for (const param of actionDef?.params ?? []) {
      if (injectedParams.has(param.key)) continue;
      if (param.default !== null && param.default !== undefined) params[param.key] = param.default;
    }
    onChange({ ...node!, action: { type, ...(Object.keys(params).length > 0 ? { params } : {}) } });
  }

  function setActionParam(key: string, value: unknown) {
    if (!node!.action) return;
    const nextAction: AppSchemaActionRef = { ...node!.action, params: { ...node!.action.params, [key]: value } };
    onChange({ ...node!, action: nextAction });
  }

  function setBinding(next: AppSchemaBinding | undefined) {
    if (next) {
      onChange({ ...node!, binding: next });
    } else {
      const { binding: _dropped, ...rest } = node!;
      onChange(rest);
    }
  }

  function setVisibility(next: VisibilityNode | undefined) {
    if (next) {
      onChange({ ...node!, visibility: next });
    } else {
      const { visibility: _dropped, ...rest } = node!;
      onChange(rest);
    }
  }

  /** CMP-10: «اختياري عند النشر» — المفتاح يُكتب `true` فقط ويُحذف عند الإيقاف (لا `false` مخزَّناً)، فلا يتغيّر مخطط قديم. جذر الصفحة لا يُعلَّم. */
  function setOptional(next: boolean) {
    if (next) {
      onChange({ ...node!, optional: true });
    } else {
      const { optional: _dropped, ...rest } = node!;
      onChange(rest);
    }
  }

  function handleAddChild() {
    if (!addType || !registries) return;
    const childDefinition = registries.components[addType];
    if (!childDefinition) return;
    onAddChild(createComponentFromDefinition(addType, childDefinition));
    setAddType('');
  }

  return (
    <div className="space-y-4 p-3">
      <div>
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-text" title={definition.type}>{registryLabel(definition.label, locale)}</h3>
          <Badge tone="muted">{definition.category}</Badge>
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-muted">{definition.notes}</p>
      </div>

      <div>
        <p className="mb-1 text-xs font-medium text-muted">{t('propsTitle')}</p>
        {definition.props.length === 0 ? (
          <p className="text-xs text-muted">{t('noProps')}</p>
        ) : (
          definition.props.map((prop) => (
            <PropRow key={prop.key} definition={prop} value={node.props?.[prop.key]} onChange={(v) => setProp(prop.key, v)} locale={locale} />
          ))
        )}
      </div>

      {node.type !== 'Page' ? (
        <div>
          <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-text">
            <input
              type="checkbox"
              className="h-6 w-6 accent-primary"
              checked={node.optional === true}
              onChange={(event) => setOptional(event.target.checked)}
            />
            {t('optionalTitle')}
          </label>
          <p className="mt-1 text-[11px] leading-relaxed text-muted">{node.optional === true ? t('optionalOn') : t('optionalOff')}</p>
        </div>
      ) : null}

      {definition.actionable ? (
        <div>
          <p className="mb-1 text-xs font-medium text-muted">{t('actionTitle')}</p>
          <Select value={node.action?.type ?? ''} onChange={(event) => attachAction(event.target.value)} className="mb-2 h-8 text-xs">
            <option value="">{t('noAction')}</option>
            {actionTypeOptions.map((type) => (
              <option key={type} value={type} title={type}>{registries ? registryLabel(registries.actions[type].label, locale) : type}</option>
            ))}
          </Select>
          {node.action && !actionDefinition ? (
            <p className="text-xs text-muted">{t('inspectorUnknownType', { type: node.action.type })}</p>
          ) : null}
          {node.action && actionDefinition ? (
            <div>
              {actionDefinition.params
                .filter((param) => !injectedParams.has(param.key))
                .map((param) => (
                  <ActionParamRow
                    key={param.key}
                    definition={param}
                    value={node.action?.params?.[param.key]}
                    onChange={(v) => setActionParam(param.key, v)}
                    pageIds={node.action?.type === 'navigate' && param.key === 'pageId' ? pageIds : undefined}
                    t={t}
                    locale={locale}
                  />
                ))}
              {actionDefinition.params.some((param) => injectedParams.has(param.key)) ? (
                <p className="pt-1 text-[11px] text-muted">{t('injectedParamNote')}</p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {advancedOnly && definition.bindable_resources.length > 0 ? (
        <BindingEditor
          binding={node.binding}
          bindableResourceIds={definition.bindable_resources}
          resources={registries?.resources ?? {}}
          ownProps={definition.props}
          onChange={setBinding}
          t={t}
        />
      ) : null}

      {advancedOnly ? <VisibilityEditor
        visibility={node.visibility}
        signals={registries?.visibility_signals ?? []}
        operators={registries?.visibility_operators ?? []}
        onChange={setVisibility}
        t={t}
      /> : null}

      {canAddChild ? (
        <div className="border-t border-border pt-3">
          <p className="mb-1 text-xs font-medium text-muted">{t('addChildTitle')}</p>
          <div className="flex items-center gap-1.5">
            <Select value={addType} onChange={(event) => setAddType(event.target.value)} className="h-8 text-xs">
              <option value="">{t('addChildPlaceholder')}</option>
              {componentTypeOptions.map((type) => (
                <option key={type} value={type} title={type}>{registries ? registryLabel(registries.components[type].label, locale) : type}</option>
              ))}
            </Select>
            <Button type="button" size="sm" className="h-8 shrink-0 text-xs" disabled={!addType} onClick={handleAddChild}>
              {t('addChildAction')}
            </Button>
          </div>
        </div>
      ) : null}

      {canRemove ? (
        <div className="border-t border-border pt-3">
          <Button type="button" variant="danger" size="sm" className="h-8 w-full text-xs" onClick={onRemove}>
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden="true" />
            {t('removeComponent')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
