'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';

interface PosConfig {
  default_customer: string;
  receipt_footer: string;
  print_receipt: boolean;
  receipt_paper_size: 'thermal_58' | 'thermal_80';
  allow_discount: boolean;
  apply_customer_price_list: boolean;
  allow_unit_price_override: boolean;
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
  cash_drawer_enabled: boolean;
  cash_drawer_driver: 'unavailable';
  cash_drawer_auto_open_after_cash: boolean;
}
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

const DEFAULTS: PosConfig = {
  default_customer: '',
  receipt_footer: '',
  print_receipt: true,
  receipt_paper_size: 'thermal_80',
  allow_discount: true,
  apply_customer_price_list: true,
  allow_unit_price_override: false,
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
  cash_drawer_enabled: false,
  cash_drawer_driver: 'unavailable',
  cash_drawer_auto_open_after_cash: false,
};

/** إعدادات تشغيل POS: السياسات ووسائل التحصيل الخادمية في مصدر إعداد واحد. */
export default function PosSettingsPage() {
  const t = useTranslations('posSettings');
  const ts = useTranslations('salesSettings');
  const tc = useTranslations('common');
  const router = useRouter();
  const { success } = useToast();
  const [config, setConfig] = useState<PosConfig | null>(null);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [settings, paymentMethods, productCategories] = await Promise.all([
        api<{ data: Partial<PosConfig> }>('/sales-config/pos'),
        api<{ data: PaymentMethod[] }>('/payment-methods'),
        api<{ data: ProductCategory[] }>('/product-categories'),
      ]);
      setConfig({ ...DEFAULTS, ...settings.data });
      setMethods(paymentMethods.data.filter((method) => method.is_active));
      setCategories(productCategories.data.filter((category) => category.is_active));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('load_failed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

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

  function setCategoryVisibility(mode: PosConfig['product_category_visibility_mode']) {
    setConfig((current) => current ? {
      ...current,
      product_category_visibility_mode: mode,
      product_category_ids: mode === 'all' ? [] : current.product_category_ids,
    } : current);
  }

  function togglePaymentMethod(methodId: string) {
    setConfig((current) => {
      if (!current) return current;
      const allIds = methods.map((method) => method.id);
      const selected = current.payment_methods_mode === 'all_active' ? allIds : current.enabled_payment_method_ids;
      const next = selected.includes(methodId)
        ? selected.filter((id) => id !== methodId)
        : [...selected, methodId];
      return {
        ...current,
        payment_methods_mode: next.length === allIds.length ? 'all_active' : (next.length > 0 ? 'only' : 'none'),
        enabled_payment_method_ids: next.length === allIds.length ? [] : next,
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
      success(tc('updated'));
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon" aria-label={t('back_to_settings')}><Link href='/pos/settings'>
          <ArrowRight className="h-4 w-4" strokeWidth={1.7} />
        </Link></Button>
        <h1 className="text-xl font-semibold text-text">{t('configuration_title')}</h1>
      </div>

      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle>{t('configuration_title')}</CardTitle>
          <p className="mt-1 text-sm text-muted">{t('configuration_subtitle')}</p>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-80 w-full" />
          ) : !config ? (
            <p className="rounded-lg bg-negative/10 px-3 py-2 text-sm text-negative">{error ?? t('load_failed')}</p>
          ) : (
            <form onSubmit={submit} className="space-y-5">
              <div className="space-y-1.5">
                <Label htmlFor="default_customer">{t('default_customer')}</Label>
                <Input id="default_customer" value={config.default_customer} onChange={(event) => patch('default_customer', event.target.value)} />
              </div>

              <label className="flex items-center gap-2 text-sm text-text">
                <input className="h-4 w-4 accent-primary focus-visible:ring-2 focus-visible:ring-primary/40" type="checkbox" checked={config.allow_discount} onChange={(event) => patch('allow_discount', event.target.checked)} />
                {t('allow_discount')}
              </label>
              <section className="space-y-1.5">
                <label className="flex items-center gap-2 text-sm text-text">
                  <input className="h-4 w-4 accent-primary focus-visible:ring-2 focus-visible:ring-primary/40" type="checkbox" checked={config.show_product_images} onChange={(event) => patch('show_product_images', event.target.checked)} />
                  {t('show_product_images')}
                </label>
                <p className="text-xs leading-relaxed text-muted">{t('show_product_images_hint')}</p>
              </section>
              <section className="space-y-1.5">
                <label className="flex items-center gap-2 text-sm text-text">
                  <input className="h-4 w-4 accent-primary focus-visible:ring-2 focus-visible:ring-primary/40" type="checkbox" checked={config.apply_customer_price_list} onChange={(event) => patch('apply_customer_price_list', event.target.checked)} />
                  {t('apply_customer_price_list')}
                </label>
                <p className="text-xs leading-relaxed text-muted">{t('apply_customer_price_list_hint')}</p>
              </section>
              <section className="space-y-1.5">
                <label className="flex items-center gap-2 text-sm text-text">
                  <input className="h-4 w-4 accent-primary focus-visible:ring-2 focus-visible:ring-primary/40" type="checkbox" checked={config.allow_unit_price_override} onChange={(event) => patch('allow_unit_price_override', event.target.checked)} />
                  {t('allow_unit_price_override')}
                </label>
                <p className="text-xs leading-relaxed text-muted">{t('allow_unit_price_override_hint')}</p>
              </section>

              <section className="space-y-3 border-t border-border pt-5">
                <div>
                  <Label>{t('payment_methods')}</Label>
                  <p className="mt-1 text-xs leading-relaxed text-muted">{t('payment_methods_hint')}</p>
                </div>
                {methods.length === 0 ? (
                  <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-text">{t('payment_methods_empty')}</p>
                ) : (
                  <>
                    <div className="grid gap-2 sm:grid-cols-2">
                    {methods.map((method) => {
                      const checked = config.payment_methods_mode === 'all_active' || (config.payment_methods_mode === 'only' && config.enabled_payment_method_ids.includes(method.id));
                      return (
                        <label key={method.id} className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-text hover:border-primary">
                          <input className="h-4 w-4 accent-primary focus-visible:ring-2 focus-visible:ring-primary/40" type="checkbox" checked={checked} onChange={() => togglePaymentMethod(method.id)} />
                          <span className="flex-1 truncate font-medium">{method.name}</span>
                          {method.is_default && <span className="text-xs text-muted">{t('default_payment_method_auto')}</span>}
                        </label>
                      );
                    })}
                    </div>
                    {config.payment_methods_mode === 'none' && <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-text">{t('payment_methods_empty')}</p>}
                    <Button type="button" variant="ghost" className="px-0 text-primary" onClick={() => setConfig((current) => current ? { ...current, payment_methods_mode: 'all_active', enabled_payment_method_ids: [], default_payment_method_id: current.default_payment_method_id } : current)}>{t('all_active_payment_methods')}</Button>
                  </>
                )}
              </section>

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

              <section className="space-y-3 border-t border-border pt-5">
                <div>
                  <Label htmlFor="product_category_visibility_mode">{t('product_category_visibility')}</Label>
                  <p className="mt-1 text-xs leading-relaxed text-muted">{t('product_category_visibility_hint')}</p>
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
                {config.product_category_visibility_mode !== 'all' && (
                  <div className="space-y-2" aria-describedby="product-category-selection-hint">
                    <Label>{t('product_category_selection')}</Label>
                    <p id="product-category-selection-hint" className="text-xs leading-relaxed text-muted">
                      {config.product_category_visibility_mode === 'only'
                        ? t('product_category_selection_only_hint')
                        : t('product_category_selection_except_hint')}
                    </p>
                    {categoryRows.length === 0 ? (
                      <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-text">{t('product_category_selection_empty')}</p>
                    ) : (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {categoryRows.map((category) => {
                          const checked = config.product_category_ids.includes(category.id);
                          return (
                            <label key={category.id} className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-text hover:border-primary">
                              <input
                                className="h-4 w-4 accent-primary focus-visible:ring-2 focus-visible:ring-primary/40"
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleCategory(category.id)}
                              />
                              <span className="truncate font-medium" style={{ paddingInlineStart: `${category.depth * 12}px` }}>{category.name}</span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
                {config.product_category_visibility_mode === 'only' && config.product_category_ids.length === 0 && (
                  <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-text">{t('product_category_visibility_only_empty')}</p>
                )}
                {config.product_category_visibility_mode === 'except' && config.product_category_ids.length === 0 && (
                  <p className="rounded-lg bg-background px-3 py-2 text-xs text-muted">{t('product_category_visibility_except_empty')}</p>
                )}
              </section>

              <section className="space-y-2 border-t border-border pt-5">
                <label className="flex items-center gap-2 text-sm font-medium text-text">
                  <input className="h-4 w-4 accent-primary focus-visible:ring-2 focus-visible:ring-primary/40" type="checkbox" checked={config.allow_deferred_payment} onChange={(event) => patch('allow_deferred_payment', event.target.checked)} />
                  {t('allow_deferred_payment')}
                </label>
                <p className="text-xs leading-relaxed text-muted">{t('allow_deferred_payment_hint')}</p>
              </section>

              <section className="space-y-2 border-t border-border pt-5" aria-labelledby="cash-drawer-contract-title">
                <Label id="cash-drawer-contract-title">{t('cash_drawer_contract')}</Label>
                <label className="flex items-center gap-2 text-sm text-muted">
                  <input className="h-4 w-4 accent-primary" type="checkbox" checked={false} disabled />
                  {t('cash_drawer_enable')}
                </label>
                <p className="text-xs leading-relaxed text-muted">{t('cash_drawer_unsupported_hint')}</p>
              </section>

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

              <div className="space-y-1.5">
                <Label htmlFor="held_sale_close_policy">{t('held_sale_close_policy')}</Label>
                <Select id="held_sale_close_policy" value={config.held_sale_close_policy} onChange={(event) => patch('held_sale_close_policy', event.target.value as PosConfig['held_sale_close_policy'])}>
                  <option value="discard_on_session_close">{t('held_sale_discard_on_session_close')}</option>
                  <option value="keep_for_next_session">{t('held_sale_keep_for_next_session')}</option>
                </Select>
                <p className="text-xs leading-relaxed text-muted">{t('held_sale_close_policy_hint')}</p>
              </div>

              {error && <p className="rounded-lg bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}

              <div className="flex justify-end pt-2">
                <Button type="submit" disabled={saving}>{ts('save')}</Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
