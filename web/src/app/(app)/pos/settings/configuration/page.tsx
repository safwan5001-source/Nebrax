'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowLeft, CreditCard, MousePointerClick, Receipt, ShieldAlert, Settings2, Tag, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Combobox, type ComboOption } from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { FieldGrid, FieldSpan, FormSection } from '@/components/nebrax/form-section';
import { api, ApiError } from '@/lib/api';
import { parsePosInteractionMode, POS_INTERACTION_MODES, type PosInteractionMode } from '@/lib/pos-interaction-policy';

type AuditOperationPolicy = 'allowed' | 'approval_required' | 'denied';

interface PosConfig {
  default_customer_id: string | null;
  default_customer: string;
  receipt_footer: string;
  print_receipt: boolean;
  receipt_paper_size: 'thermal_58' | 'thermal_80';
  allow_discount: boolean;
  apply_customer_price_list: boolean;
  allow_unit_price_override: boolean;
  show_onscreen_numeric_keypad: boolean;
  interaction_mode: PosInteractionMode;
  enabled_payment_method_ids: string[];
  payment_methods_mode: 'all_active' | 'only' | 'none';
  default_payment_method_id: string | null;
  allow_deferred_payment: boolean;
  product_category_visibility_mode: 'all' | 'only' | 'except';
  product_category_ids: string[];
  cash_refund_policy: 'original_cash_only' | 'allow_any_pos_sale';
  exchange_surplus_policy: 'customer_credit_only' | 'allow_cash_refund';
  held_sale_close_policy: 'discard_on_session_close' | 'keep_for_next_session';
  show_product_images: boolean;
  blind_cash_count_enabled: boolean;
  audit_operation_policies: Record<string, AuditOperationPolicy>;
}

interface LossPreventionConfig {
  self_approval_blocked_for_variance: boolean;
  outside_hours_grace_minutes: number;
}

const LP_DEFAULTS: LossPreventionConfig = {
  self_approval_blocked_for_variance: false,
  outside_hours_grace_minutes: 30,
};

// عمليات Phase 4 الوحيدة القابلة للضبط من هذه الشاشة؛ البقية (item_remove،
// price_override، discount_change، cart_cancel، cash_recount) رصد عميلي
// بعد الفعل أو اعتماد دائم مفروض خادمياً، فلا حاجة لتحريرها هنا.
const OPERATION_POLICY_ROWS: Array<'refund' | 'cash_out' | 'manual_drawer_open'> = ['refund', 'cash_out', 'manual_drawer_open'];

interface ProductCategory {
  id: string;
  name: string;
  parent_id: string | null;
  is_active: boolean;
}

interface PaymentMethod {
  id: string;
  name: string;
  name_en: string | null;
  settlement_type: 'cash' | 'bank';
  is_active: boolean;
  is_default: boolean;
}

interface Partner {
  id: string;
  code?: string | null;
  name: string;
  type: 'customer' | 'supplier' | 'both';
  phone?: string | null;
  mobile?: string | null;
  is_active: boolean;
}

interface ReceiptTemplateRevision {
  id: string;
  status: 'draft' | 'published' | 'superseded';
  document_types: string[];
  definition?: { template_id?: string } | Record<string, unknown>;
}

interface ReceiptTemplate {
  id: string;
  name: string;
  status: 'draft' | 'published' | 'archived';
  document_types: string[];
  published_revision: ReceiptTemplateRevision | null;
}

interface ReceiptTemplateAssignment {
  print_template_revision_id: string;
}

function isEligibleReceiptTemplate(template: ReceiptTemplate, paperSize: PosConfig['receipt_paper_size']): boolean {
  const revision = template.published_revision;
  const expectedTemplateId = paperSize === 'thermal_58' ? 'tax-invoice-thermal58' : 'tax-invoice-thermal80';
  return template.status === 'published'
    && template.document_types.includes('tax_invoice')
    && revision?.status === 'published'
    && revision.document_types.includes('tax_invoice')
    && revision.definition?.template_id === expectedTemplateId;
}

const DEFAULTS: PosConfig = {
  default_customer_id: null,
  default_customer: '',
  receipt_footer: '',
  print_receipt: true,
  receipt_paper_size: 'thermal_80',
  allow_discount: true,
  apply_customer_price_list: true,
  allow_unit_price_override: false,
  show_onscreen_numeric_keypad: false,
  interaction_mode: 'AUTO',
  enabled_payment_method_ids: [],
  payment_methods_mode: 'all_active',
  default_payment_method_id: null,
  allow_deferred_payment: true,
  product_category_visibility_mode: 'all',
  product_category_ids: [],
  cash_refund_policy: 'original_cash_only',
  exchange_surplus_policy: 'customer_credit_only',
  held_sale_close_policy: 'discard_on_session_close',
  show_product_images: true,
  blind_cash_count_enabled: false,
  audit_operation_policies: {
    item_remove: 'allowed', price_override: 'allowed', discount_change: 'allowed', cart_cancel: 'allowed', cash_recount: 'approval_required',
    refund: 'allowed', cash_out: 'allowed', manual_drawer_open: 'allowed',
  },
};

const INTERACTION_MODE_COPY: Record<PosInteractionMode, { label: 'interaction_mode_auto' | 'interaction_mode_touch' | 'interaction_mode_keyboard_mouse' | 'interaction_mode_hybrid'; hint: 'interaction_mode_auto_hint' | 'interaction_mode_touch_hint' | 'interaction_mode_keyboard_mouse_hint' | 'interaction_mode_hybrid_hint' }> = {
  AUTO: { label: 'interaction_mode_auto', hint: 'interaction_mode_auto_hint' },
  TOUCH: { label: 'interaction_mode_touch', hint: 'interaction_mode_touch_hint' },
  KEYBOARD_MOUSE: { label: 'interaction_mode_keyboard_mouse', hint: 'interaction_mode_keyboard_mouse_hint' },
  HYBRID: { label: 'interaction_mode_hybrid', hint: 'interaction_mode_hybrid_hint' },
};

/** إعدادات تشغيل POS: تبقى السياسات ووسائل التحصيل في مصدر إعداد واحد. */
export default function PosSettingsPage() {
  const t = useTranslations('posSettings');
  const tp = useTranslations('pos');
  const ts = useTranslations('salesSettings');
  const tc = useTranslations('common');
  const { success } = useToast();
  const [config, setConfig] = useState<PosConfig | null>(null);
  const [lpConfig, setLpConfig] = useState<LossPreventionConfig>(LP_DEFAULTS);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [customers, setCustomers] = useState<Partner[]>([]);
  const [receiptTemplates, setReceiptTemplates] = useState<ReceiptTemplate[]>([]);
  const [receiptTemplateRevisionId, setReceiptTemplateRevisionId] = useState('');
  const [savedReceiptTemplateRevisionId, setSavedReceiptTemplateRevisionId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [settings, lossPrevention, paymentMethods, productCategories, partners, templates, receiptAssignment] = await Promise.all([
        api<{ data: Partial<PosConfig> }>('/sales-config/pos'),
        api<{ data: Partial<LossPreventionConfig> }>('/sales-config/pos_loss_prevention'),
        api<{ data: PaymentMethod[] }>('/payment-methods'),
        api<{ data: ProductCategory[] }>('/product-categories'),
        api<{ data: Partner[] }>('/partners'),
        api<{ data: ReceiptTemplate[] }>('/print-templates'),
        api<{ data: ReceiptTemplateAssignment | null }>('/print-templates/resolve?document_type=tax_invoice&usage=thermal'),
      ]);
      const configuration = { ...settings.data } as Partial<PosConfig> & Record<string, unknown>;
      // يبقى درج النقدية في مركزه المستقل؛ لا يظهر ولا يُعاد إرساله من هذه الشاشة.
      delete configuration.cash_drawer_driver;
      delete configuration.cash_drawer_enabled;
      delete configuration.cash_drawer_auto_open_after_cash;
      setConfig({
        ...DEFAULTS,
        ...configuration,
        interaction_mode: parsePosInteractionMode(configuration.interaction_mode),
        audit_operation_policies: { ...DEFAULTS.audit_operation_policies, ...(configuration.audit_operation_policies ?? {}) },
      });
      setLpConfig({ ...LP_DEFAULTS, ...lossPrevention.data });
      setMethods(paymentMethods.data.filter((method) => method.is_active));
      setCategories(productCategories.data.filter((category) => category.is_active));
      setCustomers(partners.data.filter((partner) => partner.is_active && ['customer', 'both'].includes(partner.type)));
      setReceiptTemplates(templates.data);
      const revisionId = receiptAssignment.data?.print_template_revision_id ?? '';
      setReceiptTemplateRevisionId(revisionId);
      setSavedReceiptTemplateRevisionId(revisionId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('load_failed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  const customerOptions = useMemo<ComboOption[]>(() => customers.map((customer) => ({
    value: customer.id,
    label: customer.name,
    sub: [customer.code, customer.phone ?? customer.mobile].filter(Boolean).join(' · ') || undefined,
    hint: customer.id,
  })), [customers]);

  const eligibleReceiptTemplates = useMemo(
    () => receiptTemplates.filter((template) => isEligibleReceiptTemplate(template, config?.receipt_paper_size ?? 'thermal_80')),
    [config?.receipt_paper_size, receiptTemplates],
  );

  const enabledMethods = useMemo(() => {
    if (!config || config.payment_methods_mode === 'none') return [];
    if (config.payment_methods_mode === 'all_active') return methods;
    return methods.filter((method) => config.enabled_payment_method_ids.includes(method.id));
  }, [config, methods]);

  const categoryRows = useMemo(() => {
    const byParent = new Map<string | null, ProductCategory[]>();
    for (const category of categories) {
      const parent = category.parent_id && categories.some((candidate) => candidate.id === category.parent_id)
        ? category.parent_id
        : null;
      byParent.set(parent, [...(byParent.get(parent) ?? []), category]);
    }
    const rows: Array<ProductCategory & { depth: number }> = [];
    const walk = (parentId: string | null, depth: number) => {
      for (const category of byParent.get(parentId) ?? []) {
        rows.push({ ...category, depth });
        walk(category.id, depth + 1);
      }
    };
    walk(null, 0);
    return rows;
  }, [categories]);

  function patch<K extends keyof PosConfig>(key: K, value: PosConfig[K]) {
    setConfig((current) => current ? { ...current, [key]: value } : current);
  }

  function patchAuditPolicy(operation: string, value: AuditOperationPolicy) {
    setConfig((current) => current ? { ...current, audit_operation_policies: { ...current.audit_operation_policies, [operation]: value } } : current);
  }

  function patchLp<K extends keyof LossPreventionConfig>(key: K, value: LossPreventionConfig[K]) {
    setLpConfig((current) => ({ ...current, [key]: value }));
  }

  function setDefaultCustomer(customerId: string) {
    setConfig((current) => {
      if (!current) return current;
      const customer = customers.find((candidate) => candidate.id === customerId);
      return {
        ...current,
        default_customer_id: customer?.id ?? null,
        default_customer: customer?.name ?? current.default_customer,
      };
    });
  }

  function setCategoryVisibility(mode: PosConfig['product_category_visibility_mode']) {
    setConfig((current) => current ? {
      ...current,
      product_category_visibility_mode: mode,
      product_category_ids: mode === 'all' ? [] : current.product_category_ids,
    } : current);
  }

  function toggleCategory(categoryId: string) {
    setConfig((current) => {
      if (!current) return current;
      const selected = current.product_category_ids;
      return {
        ...current,
        product_category_ids: selected.includes(categoryId)
          ? selected.filter((id) => id !== categoryId)
          : [...selected, categoryId],
      };
    });
  }

  function setPaymentMethodMode(mode: PosConfig['payment_methods_mode']) {
    setConfig((current) => {
      if (!current) return current;
      if (mode === 'all_active') {
        const defaultPaymentMethodId = methods.some((method) => method.id === current.default_payment_method_id)
          ? current.default_payment_method_id
          : null;
        return { ...current, payment_methods_mode: mode, enabled_payment_method_ids: [], default_payment_method_id: defaultPaymentMethodId };
      }
      if (mode === 'none') {
        return { ...current, payment_methods_mode: mode, enabled_payment_method_ids: [], default_payment_method_id: null };
      }
      const selected = current.enabled_payment_method_ids.filter((id) => methods.some((method) => method.id === id));
      return {
        ...current,
        payment_methods_mode: mode,
        enabled_payment_method_ids: selected,
        default_payment_method_id: selected.includes(current.default_payment_method_id ?? '')
          ? current.default_payment_method_id
          : null,
      };
    });
  }

  function togglePaymentMethod(methodId: string) {
    setConfig((current) => {
      if (!current) return current;
      const selected = current.enabled_payment_method_ids;
      const next = selected.includes(methodId)
        ? selected.filter((id) => id !== methodId)
        : [...selected, methodId];
      return {
        ...current,
        enabled_payment_method_ids: next,
        default_payment_method_id: current.default_payment_method_id === methodId && !next.includes(methodId)
          ? null
          : current.default_payment_method_id,
      };
    });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!config) return;
    setSaving(true);
    setError(null);
    try {
      await api('/sales-config/pos', {
        method: 'PUT',
        body: {
          data: {
            ...config,
            default_payment_method_id: config.default_payment_method_id || null,
          },
        },
      });
      await api('/sales-config/pos_loss_prevention', { method: 'PUT', body: { data: lpConfig } });
      if (receiptTemplateRevisionId !== savedReceiptTemplateRevisionId) {
        if (receiptTemplateRevisionId) {
          await api('/print-templates/assignments/default', {
            method: 'PUT',
            body: {
              document_type: 'tax_invoice',
              usage: 'thermal',
              print_template_revision_id: receiptTemplateRevisionId,
            },
          });
        } else if (savedReceiptTemplateRevisionId) {
          await api('/print-templates/assignments/default', {
            method: 'DELETE',
            body: { document_type: 'tax_invoice', usage: 'thermal' },
          });
        }
      }
      success(tc('updated'));
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <Button asChild variant="ghost" size="icon" aria-label={t('back_to_settings')}>
          <Link href="/pos/settings"><ArrowLeft className="h-4 w-4 rtl:rotate-180" strokeWidth={1.7} /></Link>
        </Button>
        <div className="min-w-0 space-y-1">
          <h1 className="text-xl font-semibold text-text">{t('configuration_title')}</h1>
          <p className="text-sm leading-relaxed text-muted">{t('configuration_subtitle')}</p>
        </div>
      </div>

      {loading ? (
        <div className="max-w-5xl space-y-4" aria-busy="true" aria-label={t('configuration_loading')}>
          {[1, 2, 3, 4, 5].map((section) => <Skeleton key={section} className="h-40 w-full" />)}
        </div>
      ) : !config ? (
        <p role="alert" className="max-w-5xl rounded-md bg-negative/10 px-3 py-2 text-sm text-negative">
          {error ?? t('load_failed')}
        </p>
      ) : (
        <form onSubmit={submit} className="max-w-5xl space-y-4">
          {error ? <p role="alert" className="rounded-md bg-negative/10 px-3 py-2 text-sm text-negative">{error}</p> : null}

          <FormSection title={t('section_interaction')} description={t('section_interaction_description')} icon={MousePointerClick} contentClassName="space-y-4">
            <fieldset className="space-y-2" data-testid="pos-interaction-mode">
              <legend className="text-sm font-medium text-text">{t('interaction_mode')}</legend>
              <p id="interaction-mode-hint" className="text-xs leading-relaxed text-muted">{t('interaction_mode_hint')}</p>
              <div className="grid grid-cols-1 gap-2" role="presentation">
                {POS_INTERACTION_MODES.map((mode) => {
                  const selected = config.interaction_mode === mode;
                  const optionId = `interaction_mode_${mode}`;
                  const copy = INTERACTION_MODE_COPY[mode];
                  return (
                    <label
                      key={mode}
                      htmlFor={optionId}
                      className={
                        'flex min-h-11 cursor-pointer items-start gap-3 rounded-md border px-3 py-3 text-start ' +
                        (selected ? 'border-primary bg-primary-soft' : 'border-border hover:border-primary')
                      }
                    >
                      <input
                        id={optionId}
                        className="mt-0.5 h-4 w-4 shrink-0 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                        type="radio"
                        name="interaction_mode"
                        value={mode}
                        checked={selected}
                        onChange={() => patch('interaction_mode', mode)}
                        aria-describedby={`${optionId}_hint`}
                      />
                      <span className="min-w-0 space-y-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className={'text-sm font-medium ' + (selected ? 'text-primary' : 'text-text')}>
                            {t(copy.label)}
                          </span>
                          {mode === 'AUTO' ? (
                            <span className="text-xs font-medium text-muted">{t('interaction_mode_auto_badge')}</span>
                          ) : null}
                        </span>
                        <span id={`${optionId}_hint`} className="block text-xs leading-relaxed text-muted">
                          {t(copy.hint)}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          </FormSection>

          <FormSection title={t('section_customer_sales')} description={t('section_customer_sales_description')} icon={Users} contentClassName="space-y-4">
            <FieldGrid>
              <FieldSpan>
                <div className="space-y-1.5">
                  <Label htmlFor="default_customer_id">{t('default_customer')}</Label>
                  <Combobox
                    id="default_customer_id"
                    value={config.default_customer_id ?? ''}
                    onChange={setDefaultCustomer}
                    options={customerOptions}
                    placeholder={tp('walkin_customer')}
                    searchPlaceholder={tp('customer_search')}
                    emptyText={tp('no_customers')}
                    clearLabel={tp('walkin_customer')}
                    aria-label={t('default_customer')}
                  />
                  <p className="text-xs leading-relaxed text-muted">{t('default_customer_hint')}</p>
                </div>
              </FieldSpan>

              <div className="border-b border-border py-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 space-y-1">
                    <p id="apply_customer_price_list_label" className="text-sm font-medium text-text">{t('apply_customer_price_list')}</p>
                    <p className="text-xs leading-relaxed text-muted">{t('apply_customer_price_list_hint')}</p>
                  </div>
                  <Switch checked={config.apply_customer_price_list} onCheckedChange={(checked) => patch('apply_customer_price_list', checked)} aria-labelledby="apply_customer_price_list_label" />
                </div>
              </div>

              <div className="border-b border-border py-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 space-y-1">
                    <p id="allow_deferred_payment_label" className="text-sm font-medium text-text">{t('allow_deferred_payment')}</p>
                    <p className="text-xs leading-relaxed text-muted">{t('allow_deferred_payment_hint')}</p>
                  </div>
                  <Switch checked={config.allow_deferred_payment} onCheckedChange={(checked) => patch('allow_deferred_payment', checked)} aria-labelledby="allow_deferred_payment_label" />
                </div>
              </div>
            </FieldGrid>
          </FormSection>

          <FormSection title={t('section_products_pricing')} description={t('section_products_pricing_description')} icon={Tag} contentClassName="space-y-4">
            <FieldGrid>
              <div className="border-b border-border py-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 space-y-1">
                    <p id="show_product_images_label" className="text-sm font-medium text-text">{t('show_product_images')}</p>
                    <p className="text-xs leading-relaxed text-muted">{t('show_product_images_hint')}</p>
                  </div>
                  <Switch checked={config.show_product_images} onCheckedChange={(checked) => patch('show_product_images', checked)} aria-labelledby="show_product_images_label" />
                </div>
              </div>

              <div className="border-b border-border py-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 space-y-1">
                    <p id="allow_discount_label" className="text-sm font-medium text-text">{t('allow_discount')}</p>
                    <p className="text-xs leading-relaxed text-muted">{t('allow_discount_hint')}</p>
                  </div>
                  <Switch checked={config.allow_discount} onCheckedChange={(checked) => patch('allow_discount', checked)} aria-labelledby="allow_discount_label" />
                </div>
              </div>

              <div className="border-b border-border py-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 space-y-1">
                    <p id="allow_unit_price_override_label" className="text-sm font-medium text-text">{t('allow_unit_price_override')}</p>
                    <p className="text-xs leading-relaxed text-muted">{t('allow_unit_price_override_hint')}</p>
                  </div>
                  <Switch checked={config.allow_unit_price_override} onCheckedChange={(checked) => patch('allow_unit_price_override', checked)} aria-labelledby="allow_unit_price_override_label" />
                </div>
              </div>

              <div className="border-b border-border py-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 space-y-1">
                    <p id="show_onscreen_numeric_keypad_label" className="text-sm font-medium text-text">{t('show_onscreen_numeric_keypad')}</p>
                    <p className="text-xs leading-relaxed text-muted">{t('show_onscreen_numeric_keypad_hint')}</p>
                  </div>
                  <Switch checked={config.show_onscreen_numeric_keypad} onCheckedChange={(checked) => patch('show_onscreen_numeric_keypad', checked)} aria-labelledby="show_onscreen_numeric_keypad_label" />
                </div>
              </div>

              <FieldSpan>
                <div className="space-y-3 border-t border-border pt-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="product_category_visibility_mode">{t('product_category_visibility')}</Label>
                    <p className="text-xs leading-relaxed text-muted">{t('product_category_visibility_hint')}</p>
                  </div>
                  <Select
                    id="product_category_visibility_mode"
                    value={config.product_category_visibility_mode}
                    onChange={(event) => setCategoryVisibility(event.target.value as PosConfig['product_category_visibility_mode'])}
                  >
                    <option value="all">{t('product_category_visibility_all')}</option>
                    <option value="only">{t('product_category_visibility_only')}</option>
                    <option value="except">{t('product_category_visibility_except')}</option>
                  </Select>

                  {config.product_category_visibility_mode !== 'all' ? (
                    <div className="space-y-2" aria-describedby="product-category-selection-hint">
                      <Label>{t('product_category_selection')}</Label>
                      <p id="product-category-selection-hint" className="text-xs leading-relaxed text-muted">
                        {config.product_category_visibility_mode === 'only'
                          ? t('product_category_selection_only_hint')
                          : t('product_category_selection_except_hint')}
                      </p>
                      {categoryRows.length === 0 ? (
                        <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-text">{t('product_category_selection_empty')}</p>
                      ) : (
                        <div className="grid max-h-72 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
                          {categoryRows.map((category) => {
                            const checked = config.product_category_ids.includes(category.id);
                            return (
                              <label key={category.id} className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md border border-border bg-background/40 px-3 py-2 text-sm text-text hover:border-primary">
                                <input className="h-4 w-4 shrink-0 accent-primary focus-visible:ring-2 focus-visible:ring-primary/40" type="checkbox" checked={checked} onChange={() => toggleCategory(category.id)} />
                                <span className="flex min-w-0 flex-1 items-center">
                                  {Array.from({ length: Math.min(category.depth, 3) }).map((_, index) => <span key={index} aria-hidden="true" className="w-3 shrink-0" />)}
                                  <span className="min-w-0 break-words font-medium">{category.name}</span>
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ) : null}

                  {config.product_category_visibility_mode === 'only' && config.product_category_ids.length === 0 ? (
                    <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-text">{t('product_category_visibility_only_empty')}</p>
                  ) : null}
                  {config.product_category_visibility_mode === 'except' && config.product_category_ids.length === 0 ? (
                    <p className="rounded-md bg-background px-3 py-2 text-xs text-muted">{t('product_category_visibility_except_empty')}</p>
                  ) : null}
                </div>
              </FieldSpan>
            </FieldGrid>
          </FormSection>

          <FormSection title={t('section_payment')} description={t('section_payment_description')} icon={CreditCard} contentClassName="space-y-4">
            <FieldGrid>
              <FieldSpan>
                <div className="space-y-1.5">
                  <Label htmlFor="payment_methods_mode">{t('payment_methods')}</Label>
                  <p className="text-xs leading-relaxed text-muted">{t('payment_methods_hint')}</p>
                  <Select
                    id="payment_methods_mode"
                    value={config.payment_methods_mode}
                    onChange={(event) => setPaymentMethodMode(event.target.value as PosConfig['payment_methods_mode'])}
                  >
                    <option value="all_active">{t('payment_methods_mode_all_active')}</option>
                    <option value="only">{t('payment_methods_mode_only')}</option>
                    <option value="none">{t('payment_methods_mode_none')}</option>
                  </Select>
                </div>
              </FieldSpan>

              {methods.length === 0 ? (
                <FieldSpan><p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-text">{t('payment_methods_empty')}</p></FieldSpan>
              ) : null}

              {config.payment_methods_mode === 'all_active' && methods.length > 0 ? (
                <FieldSpan><p className="rounded-md bg-primary-soft px-3 py-2 text-sm text-text">{t('payment_methods_mode_all_active_hint')}</p></FieldSpan>
              ) : null}

              {config.payment_methods_mode === 'only' && methods.length > 0 ? (
                <FieldSpan>
                  <div className="space-y-2">
                    <Label>{t('enabled_payment_methods')}</Label>
                    <p className="text-xs leading-relaxed text-muted">{t('payment_methods_mode_only_hint')}</p>
                    <div className="grid max-h-72 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
                      {methods.map((method) => {
                        const checked = config.enabled_payment_method_ids.includes(method.id);
                        return (
                          <label key={method.id} className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md border border-border bg-background/40 px-3 py-2 text-sm text-text hover:border-primary">
                            <input className="h-4 w-4 shrink-0 accent-primary focus-visible:ring-2 focus-visible:ring-primary/40" type="checkbox" checked={checked} onChange={() => togglePaymentMethod(method.id)} />
                            <span className="min-w-0 flex-1 break-words font-medium">{method.name}</span>
                            {method.is_default ? <span className="shrink-0 text-xs text-muted">{t('default_payment_method_auto')}</span> : null}
                          </label>
                        );
                      })}
                    </div>
                    {config.enabled_payment_method_ids.length === 0 ? <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-text">{t('payment_methods_mode_only_empty')}</p> : null}
                  </div>
                </FieldSpan>
              ) : null}

              {config.payment_methods_mode === 'none' ? (
                <FieldSpan><p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-text">{t('payment_methods_mode_none_hint')}</p></FieldSpan>
              ) : null}

              {config.payment_methods_mode !== 'none' ? (
                <FieldSpan>
                  <div className="space-y-1.5">
                    <Label htmlFor="default_payment_method_id">{t('default_payment_method')}</Label>
                    <Select
                      id="default_payment_method_id"
                      value={config.default_payment_method_id ?? ''}
                      disabled={enabledMethods.length === 0}
                      onChange={(event) => patch('default_payment_method_id', event.target.value || null)}
                    >
                      <option value="">{t('default_payment_method_auto')}</option>
                      {enabledMethods.map((method) => <option key={method.id} value={method.id}>{method.name}</option>)}
                    </Select>
                    <p className="text-xs leading-relaxed text-muted">{t('default_payment_method_hint')}</p>
                  </div>
                </FieldSpan>
              ) : null}
            </FieldGrid>
          </FormSection>

          <FormSection title={t('section_receipt_printing')} description={t('section_receipt_printing_description')} icon={Receipt} contentClassName="space-y-4">
            <div className="border-b border-border py-3">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 space-y-1">
                  <p id="print_receipt_label" className="text-sm font-medium text-text">{t('print_receipt')}</p>
                  <p className="text-xs leading-relaxed text-muted">{t('print_receipt_hint')}</p>
                </div>
                <Switch checked={config.print_receipt} onCheckedChange={(checked) => patch('print_receipt', checked)} aria-labelledby="print_receipt_label" />
              </div>
            </div>

            <FieldGrid>
              <div className={config.print_receipt ? 'space-y-1.5' : 'space-y-1.5 opacity-50'}>
                <Label htmlFor="receipt_paper_size">{t('receipt_paper_size')}</Label>
                <Select
                  id="receipt_paper_size"
                  value={config.receipt_paper_size}
                  disabled={!config.print_receipt}
                  onChange={(event) => {
                    const paperSize = event.target.value as PosConfig['receipt_paper_size'];
                    patch('receipt_paper_size', paperSize);
                    setReceiptTemplateRevisionId((current) => receiptTemplates.some((template) => (
                      template.published_revision?.id === current && isEligibleReceiptTemplate(template, paperSize)
                    )) ? current : '');
                  }}
                >
                  <option value="thermal_80">{t('receipt_paper_80')}</option>
                  <option value="thermal_58">{t('receipt_paper_58')}</option>
                </Select>
                <p className="text-xs leading-relaxed text-muted">{t('receipt_paper_size_hint')}</p>
              </div>

              <div className={config.print_receipt ? 'space-y-1.5' : 'space-y-1.5 opacity-50'}>
                <Label htmlFor="default_pos_receipt_template">{t('default_pos_receipt_template')}</Label>
                <Select
                  id="default_pos_receipt_template"
                  value={receiptTemplateRevisionId}
                  disabled={!config.print_receipt || eligibleReceiptTemplates.length === 0}
                  onChange={(event) => setReceiptTemplateRevisionId(event.target.value)}
                >
                  <option value="">{t('default_pos_receipt_template_fallback')}</option>
                  {eligibleReceiptTemplates.map((template) => (
                    <option key={template.published_revision!.id} value={template.published_revision!.id}>{template.name}</option>
                  ))}
                </Select>
                <p className="text-xs leading-relaxed text-muted">{t('default_pos_receipt_template_hint')}</p>
                {eligibleReceiptTemplates.length === 0 ? (
                  <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs leading-relaxed text-text">
                    {t('default_pos_receipt_template_empty')} <Link className="font-medium text-primary hover:underline" href="/document-design">{t('default_pos_receipt_template_manage')}</Link>
                  </p>
                ) : null}
                {receiptTemplateRevisionId ? (
                  <Button type="button" variant="ghost" size="sm" disabled={!config.print_receipt} onClick={() => setReceiptTemplateRevisionId('')}>
                    {t('default_pos_receipt_template_reset')}
                  </Button>
                ) : null}
              </div>

              <div className={config.print_receipt ? 'space-y-1.5' : 'space-y-1.5 opacity-50'}>
                <Label htmlFor="receipt_footer">{t('receipt_footer')}</Label>
                <Textarea
                  id="receipt_footer"
                  value={config.receipt_footer}
                  disabled={!config.print_receipt}
                  onChange={(event) => patch('receipt_footer', event.target.value)}
                  rows={4}
                />
                <p className="text-xs leading-relaxed text-muted">{config.print_receipt ? t('receipt_footer_hint') : t('receipt_printing_disabled_hint')}</p>
              </div>
            </FieldGrid>
          </FormSection>

          <FormSection title={t('section_operating_policies')} description={t('section_operating_policies_description')} icon={Settings2} contentClassName="space-y-4">
            <FieldGrid>
              <div className="space-y-1.5">
                <Label htmlFor="cash_refund_policy">{t('cash_refund_policy')}</Label>
                <Select id="cash_refund_policy" value={config.cash_refund_policy} onChange={(event) => patch('cash_refund_policy', event.target.value as PosConfig['cash_refund_policy'])}>
                  <option value="original_cash_only">{t('cash_refund_original_cash_only')}</option>
                  <option value="allow_any_pos_sale">{t('cash_refund_allow_any_pos_sale')}</option>
                </Select>
                <p className="text-xs leading-relaxed text-muted">{t('cash_refund_policy_hint')}</p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="exchange_surplus_policy">{t('exchange_surplus_policy')}</Label>
                <Select id="exchange_surplus_policy" value={config.exchange_surplus_policy} onChange={(event) => patch('exchange_surplus_policy', event.target.value as PosConfig['exchange_surplus_policy'])}>
                  <option value="customer_credit_only">{t('exchange_surplus_customer_credit_only')}</option>
                  <option value="allow_cash_refund">{t('exchange_surplus_allow_cash_refund')}</option>
                </Select>
                <p className="text-xs leading-relaxed text-muted">{t('exchange_surplus_policy_hint')}</p>
              </div>

              <FieldSpan>
                <div className="rounded border border-border bg-background p-3">
                  <div className="flex items-center gap-2"><Switch id="blind_cash_count_enabled" checked={config.blind_cash_count_enabled} onCheckedChange={(checked) => patch('blind_cash_count_enabled', checked)} aria-labelledby="blind-cash-count-label" /><Label id="blind-cash-count-label" htmlFor="blind_cash_count_enabled">{t('blind_cash_count_enabled')}</Label></div>
                  <p className="mt-1 ps-8 text-xs leading-relaxed text-muted">{t('blind_cash_count_enabled_hint')}</p>
                </div>
              </FieldSpan>

              <FieldSpan>
                <div className="space-y-1.5">
                  <Label htmlFor="held_sale_close_policy">{t('held_sale_close_policy')}</Label>
                  <Select id="held_sale_close_policy" value={config.held_sale_close_policy} onChange={(event) => patch('held_sale_close_policy', event.target.value as PosConfig['held_sale_close_policy'])}>
                    <option value="discard_on_session_close">{t('held_sale_discard_on_session_close')}</option>
                    <option value="keep_for_next_session">{t('held_sale_keep_for_next_session')}</option>
                  </Select>
                  <p className="text-xs leading-relaxed text-muted">{t('held_sale_close_policy_hint')}</p>
                </div>
              </FieldSpan>
            </FieldGrid>
          </FormSection>

          <FormSection title={t('section_loss_prevention')} description={t('section_loss_prevention_description')} icon={ShieldAlert} contentClassName="space-y-4">
            <FieldGrid>
              {OPERATION_POLICY_ROWS.map((operation) => (
                <div key={operation} className="space-y-1.5">
                  <Label htmlFor={`audit_operation_policy_${operation}`}>{t(`audit_operation_policy_${operation}`)}</Label>
                  <Select
                    id={`audit_operation_policy_${operation}`}
                    value={config.audit_operation_policies[operation] ?? 'allowed'}
                    onChange={(event) => patchAuditPolicy(operation, event.target.value as AuditOperationPolicy)}
                  >
                    <option value="allowed">{t('audit_policy_allowed')}</option>
                    <option value="approval_required">{t('audit_policy_approval_required')}</option>
                    <option value="denied">{t('audit_policy_denied')}</option>
                  </Select>
                  <p className="text-xs leading-relaxed text-muted">{t(`audit_operation_policy_${operation}_hint`)}</p>
                </div>
              ))}

              <FieldSpan>
                <div className="rounded border border-border bg-background p-3">
                  <div className="flex items-center gap-2">
                    <Switch id="self_approval_blocked_for_variance" checked={lpConfig.self_approval_blocked_for_variance} onCheckedChange={(checked) => patchLp('self_approval_blocked_for_variance', checked)} aria-labelledby="self-approval-blocked-label" />
                    <Label id="self-approval-blocked-label" htmlFor="self_approval_blocked_for_variance">{t('self_approval_blocked_for_variance')}</Label>
                  </div>
                  <p className="mt-1 ps-8 text-xs leading-relaxed text-muted">{t('self_approval_blocked_for_variance_hint')}</p>
                </div>
              </FieldSpan>

              <div className="space-y-1.5">
                <Label htmlFor="outside_hours_grace_minutes">{t('outside_hours_grace_minutes')}</Label>
                <Input
                  id="outside_hours_grace_minutes"
                  type="number"
                  min={0}
                  max={240}
                  className="num"
                  value={lpConfig.outside_hours_grace_minutes}
                  onChange={(event) => patchLp('outside_hours_grace_minutes', Math.min(240, Math.max(0, Number(event.target.value) || 0)))}
                />
                <p className="text-xs leading-relaxed text-muted">{t('outside_hours_grace_minutes_hint')}</p>
              </div>
            </FieldGrid>
          </FormSection>

          <div className="flex flex-col-reverse gap-3 pb-2 sm:flex-row sm:justify-end">
            <Button asChild variant="outline"><Link href="/pos/settings">{t('back_to_settings')}</Link></Button>
            <Button type="submit" disabled={saving}>{saving ? t('saving') : ts('save')}</Button>
          </div>
        </form>
      )}
    </div>
  );
}
