'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { type ColumnDef } from '@tanstack/react-table';
import { ChevronLeft, ChevronRight, Copy, Eye, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { AdvancedFilterDialog } from '@/components/data-explorer/advanced-filter-dialog';
import { DataExplorerToolbar } from '@/components/data-explorer/data-explorer-toolbar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { ProductDialog, type Product } from '@/components/products/product-dialog';
import { api, ApiError } from '@/lib/api';
import { formatRiyal } from '@/lib/money';
import { getSystemTaxInclusive } from '@/lib/tax';
import { getShowStockQuantities } from '@/lib/inventory';
import { useToast } from '@/components/ui/toast';
import type { ActiveFilter, DataExplorerState, FilterDefinition } from '@/lib/data-explorer/types';
import { parseExplorerState, removeFilter, replaceFilter, serializeExplorerState } from '@/lib/data-explorer/url-state';

interface ProductCategory { id: string; name: string; parent_id: string | null; is_active: boolean; products_count?: number; }
function isEmptyFilter(filter: ActiveFilter): boolean { return Array.isArray(filter.value) ? filter.value.every((v) => String(v).trim() === '') : String(filter.value).trim() === ''; }
function moneyMatches(value: number, filter?: ActiveFilter): boolean {
  if (!filter || Array.isArray(filter.value) || String(filter.value).trim() === '') return true;
  const target = Number(filter.value); if (!Number.isFinite(target)) return true;
  if (filter.operator === 'lte' || filter.operator === 'lt') return value <= target;
  if (filter.operator === 'eq') return value === target;
  return value >= target;
}

export default function ProductsPage() {
  const t = useTranslations('products'); const router = useRouter(); const searchParams = useSearchParams(); const { success, error } = useToast();
  const [explorer, setExplorer] = useState<DataExplorerState>(() => { const p = parseExplorerState(new URLSearchParams(searchParams.toString())); return { ...p, perPage: p.perPage ?? 25, sort: p.sort ?? 'name' }; });
  const [searchInput, setSearchInput] = useState(explorer.search); const [advancedOpen, setAdvancedOpen] = useState(false);
  const [data, setData] = useState<Product[]>([]); const [categories, setCategories] = useState<ProductCategory[]>([]); const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState(false); const [editing, setEditing] = useState<Product | null>(null); const [taxInclusive, setTaxInclusive] = useState(false); const [showStock, setShowStock] = useState(true); const [workingId, setWorkingId] = useState<string | null>(null);

  const load = useCallback(() => { setLoading(true); Promise.all([api<{data:Product[]}>('/products'), api<{data:ProductCategory[]}>('/product-categories')]).then(([p,c]) => { setData(p.data); setCategories(c.data); }).finally(() => setLoading(false)); }, []);
  useEffect(() => load(), [load]); useEffect(() => { getSystemTaxInclusive().then(setTaxInclusive).catch(() => {}); }, []); useEffect(() => { getShowStockQuantities().then(setShowStock).catch(() => {}); }, []);
  useEffect(() => { const timer = window.setTimeout(() => setExplorer((cur) => cur.search === searchInput ? cur : {...cur, search:searchInput, page:1}), 300); return () => window.clearTimeout(timer); }, [searchInput]);
  useEffect(() => { const url=serializeExplorerState(explorer); router.replace(url.toString()?`/products?${url}`:'/products',{scroll:false}); }, [explorer,router]);

  const categoryNames=useMemo(()=>Object.fromEntries(categories.map(c=>[c.id,c.name])),[categories]);
  const definitions=useMemo<FilterDefinition[]>(()=>[
    {key:'category_id',label:'التصنيف',kind:'entity',quick:true,searchPlaceholder:'ابحث باسم التصنيف',emptyText:'لا يوجد تصنيف مطابق',options:categories.map(c=>({value:c.id,label:c.name,sub:c.parent_id?categoryNames[c.parent_id]:undefined,hint:c.products_count!=null?`${c.products_count} منتج`:undefined}))},
    {key:'type',label:t('type'),kind:'select',quick:true,options:[{value:'good',label:t('good')},{value:'service',label:t('service')}]},
    {key:'is_active',label:t('status_label'),kind:'select',quick:true,options:[{value:'1',label:t('active')},{value:'0',label:t('inactive')}]},
    {key:'stock_state',label:'المخزون',kind:'select',options:[{value:'tracked',label:'متتبع للمخزون'},{value:'not_tracked',label:'غير متتبع'},{value:'low',label:'منخفض'},{value:'out',label:'نفد المخزون'}]},
    {key:'sale_price',label:t('sale_price'),kind:'money',operators:['gte','lte','eq']},{key:'purchase_price',label:'سعر الشراء',kind:'money',operators:['gte','lte','eq']},
  ],[categories,categoryNames,t]);
  const labelledFilters=useMemo(()=>explorer.filters.map(f=>({...f,label:definitions.find(d=>d.key===f.key)?.label??f.label})),[definitions,explorer.filters]);
  const filtered=useMemo(()=>{ const byKey=new Map(explorer.filters.map(f=>[f.key,f])); const q=explorer.search.trim().toLocaleLowerCase(); return data.filter(p=>{
    if(q && ![p.name,p.name_en,p.sku,p.barcode,p.category,p.brand].filter(Boolean).join(' ').toLocaleLowerCase().includes(q)) return false;
    const category=byKey.get('category_id'); if(category&&!Array.isArray(category.value)&&String(category.value)&&p.category_id!==String(category.value)) return false;
    const type=byKey.get('type'); if(type&&!Array.isArray(type.value)&&String(type.value)&&p.type!==String(type.value)) return false;
    const active=byKey.get('is_active'); if(active&&!Array.isArray(active.value)&&String(active.value)!==''&&p.is_active!==(String(active.value)==='1')) return false;
    const stock=byKey.get('stock_state'); if(stock&&!Array.isArray(stock.value)&&String(stock.value)){const s=String(stock.value),qty=Number(p.quantity_on_hand??0),reorder=Number(p.reorder_level??0); if(s==='tracked'&&!p.track_inventory)return false;if(s==='not_tracked'&&p.track_inventory)return false;if(s==='out'&&(!p.track_inventory||qty>0))return false;if(s==='low'&&(!p.track_inventory||qty<=0||reorder<=0||qty>reorder))return false;}
    return moneyMatches(Number(p.sale_price),byKey.get('sale_price'))&&moneyMatches(Number(p.purchase_price),byKey.get('purchase_price'));
  });},[data,explorer.filters,explorer.search]);
  const sorted=useMemo(()=>{const next=[...filtered],sort=explorer.sort??'name',desc=sort.startsWith('-'),key=sort.replace(/^-/,'');next.sort((a,b)=>{let l:string|number='',r:string|number='';if(['sale_price','purchase_price','quantity_on_hand'].includes(key)){l=Number(a[key as 'sale_price'|'purchase_price'|'quantity_on_hand']??0);r=Number(b[key as 'sale_price'|'purchase_price'|'quantity_on_hand']??0);}else if(key==='sku'){l=a.sku??'';r=b.sku??'';}else{l=a.name??'';r=b.name??'';}const c=typeof l==='number'&&typeof r==='number'?l-r:String(l).localeCompare(String(r),'ar');return desc?-c:c;});return next;},[explorer.sort,filtered]);
  const perPage=explorer.perPage??25,totalPages=Math.max(1,Math.ceil(sorted.length/perPage)),page=Math.min(explorer.page??1,totalPages),pageData=sorted.slice((page-1)*perPage,page*perPage);
  function updateFilter(next:ActiveFilter){setExplorer(cur=>({...cur,page:1,filters:isEmptyFilter(next)?removeFilter(cur.filters,next.key):replaceFilter(cur.filters,next)}));}

  async function copyProduct(product: Product) { setWorkingId(product.id); try { await api('/products',{method:'POST',body:{name:`${product.name} — ${t('copy')}`,name_en:product.name_en,sku:null,barcode:null,type:product.type,unit:product.unit,description:product.description,category_id:product.category_id,brand_id:product.brand_id,unit_template_id:product.unit_template_id,reorder_level:product.reorder_level,min_sale_price:product.min_sale_price?Math.round(Number(product.min_sale_price)*100):null,discount:product.discount,discount_type:product.discount_type,profit_margin:product.profit_margin,tags:product.tags,internal_notes:product.internal_notes,sales_account_id:product.sales_account_id,cogs_account_id:product.cogs_account_id,sale_price:Math.round(Number(product.sale_price)*100),purchase_price:Math.round(Number(product.purchase_price)*100),tax_rate:product.tax_rate,track_inventory:product.track_inventory,initial_quantity:0,is_active:product.is_active}}); success(t('copy_success')); load(); } catch(err){error(err instanceof ApiError?err.message:t('action_failed'));} finally{setWorkingId(null);} }
  async function deleteProduct(product: Product) { if(!window.confirm(t('delete_confirm',{name:product.name})))return;setWorkingId(product.id);try{await api(`/products/${product.id}`,{method:'DELETE'});success(t('delete_success'));load();}catch(err){error(err instanceof ApiError?err.message:t('action_failed'));}finally{setWorkingId(null);} }

  const columns=useMemo<ColumnDef<Product,unknown>[]>(()=>[
    {accessorKey:'sku',header:t('sku'),cell:({row})=><span className="num text-muted">{row.original.sku??'—'}</span>},{accessorKey:'name',header:t('name'),cell:({row})=><Link href={`/products/${row.original.id}`} className="font-medium text-primary hover:underline">{row.original.name}</Link>},{accessorKey:'type',header:t('type'),cell:({row})=><Badge tone="muted">{t(row.original.type==='service'?'service':'good')}</Badge>},{accessorKey:'sale_price',header:`${t('sale_price')} · ${taxInclusive?t('tax_incl_tag'):t('tax_excl_tag')}`,cell:({row})=><div className="num text-end">{formatRiyal(row.original.sale_price)}</div>},{accessorKey:'barcode',header:t('barcode'),cell:({row})=><span className="num text-muted" dir="ltr">{row.original.barcode??'—'}</span>},
    ...(showStock?[{id:'stock',header:t('stock'),accessorFn:(r:Product)=>(r.track_inventory?r.quantity_on_hand:''),cell:({row}:any)=><div className="num text-end">{row.original.track_inventory?row.original.quantity_on_hand:'—'}</div>} as ColumnDef<Product,unknown>]:[]),
    {accessorKey:'is_active',header:t('status_label'),cell:({row})=><Badge tone={row.original.is_active?'positive':'muted'}>{row.original.is_active?t('active'):t('inactive')}</Badge>},{id:'actions',header:'',cell:({row})=>{const product=row.original,working=workingId===product.id;return <div className="flex items-center justify-end gap-1"><Button asChild type="button" variant="ghost" size="icon" aria-label={t('view')}><Link href={`/products/${product.id}`}><Eye className="h-4 w-4" strokeWidth={1.7}/></Link></Button><Button type="button" variant="ghost" size="icon" aria-label={t('edit')} disabled={working} onClick={()=>{setEditing(product);setDialog(true);}}><Pencil className="h-4 w-4" strokeWidth={1.7}/></Button><Button type="button" variant="ghost" size="icon" aria-label={t('copy')} disabled={working} onClick={()=>void copyProduct(product)}><Copy className="h-4 w-4" strokeWidth={1.7}/></Button><Button type="button" variant="ghost" size="icon" aria-label={t('delete')} disabled={working} onClick={()=>void deleteProduct(product)}><Trash2 className="h-4 w-4 text-negative" strokeWidth={1.7}/></Button></div>;}}
  ],[t,taxInclusive,showStock,workingId]);

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-3"><h1 className="text-xl font-semibold text-text">{t('title')}</h1><div className="ms-auto flex items-center gap-2"><Button asChild variant="outline"><Link href="/products/import"><Upload className="h-4 w-4" strokeWidth={1.7}/>{t('import')}</Link></Button><Link href="/products/new"><Button><Plus className="h-4 w-4" strokeWidth={1.8}/>{t('add')}</Button></Link></div></div>
    <DataExplorerToolbar search={searchInput} searchPlaceholder={`${t('search')} · SKU · ${t('barcode')}`} onSearchChange={setSearchInput} definitions={definitions} filters={labelledFilters} onFilterChange={updateFilter} onRemoveFilter={(key)=>setExplorer(cur=>({...cur,page:1,filters:removeFilter(cur.filters,key)}))} onClearFilters={()=>setExplorer(cur=>({...cur,page:1,filters:[]}))} onOpenAdvanced={()=>setAdvancedOpen(true)} resultCount={sorted.length} totalCount={data.length}/>
    <div className="flex items-center justify-end gap-2"><span className="text-xs text-muted">ترتيب حسب</span><Select value={explorer.sort??'name'} onChange={e=>setExplorer(cur=>({...cur,page:1,sort:e.target.value}))} className="h-9 min-w-44 bg-surface text-sm" aria-label="ترتيب المنتجات"><option value="name">الاسم: أ-ي</option><option value="-name">الاسم: ي-أ</option><option value="sku">SKU</option><option value="-sale_price">سعر البيع: الأعلى</option><option value="sale_price">سعر البيع: الأقل</option><option value="-purchase_price">سعر الشراء: الأعلى</option><option value="-quantity_on_hand">المخزون: الأعلى</option><option value="quantity_on_hand">المخزون: الأقل</option></Select></div>
    <DataTable columns={columns} data={pageData} loading={loading} emptyLabel={t('empty')} exportName="products" showToolbar={false}/>
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-muted">{sorted.length.toLocaleString('ar-SA')} منتج · صفحة {page.toLocaleString('ar-SA')} من {totalPages.toLocaleString('ar-SA')}</p><div className="flex items-center gap-2"><Select value={String(perPage)} onChange={e=>setExplorer(cur=>({...cur,page:1,perPage:Number(e.target.value)}))} className="h-9 w-24 bg-surface text-sm" aria-label="عدد النتائج في الصفحة"><option value="25">25</option><option value="50">50</option><option value="100">100</option></Select><Button variant="outline" size="icon" aria-label="الصفحة السابقة" disabled={loading||page<=1} onClick={()=>setExplorer(cur=>({...cur,page:Math.max(1,page-1)}))}><ChevronRight className="h-4 w-4"/></Button><Button variant="outline" size="icon" aria-label="الصفحة التالية" disabled={loading||page>=totalPages} onClick={()=>setExplorer(cur=>({...cur,page:Math.min(totalPages,page+1)}))}><ChevronLeft className="h-4 w-4"/></Button></div></div>
    <AdvancedFilterDialog open={advancedOpen} onClose={()=>setAdvancedOpen(false)} definitions={definitions} filters={labelledFilters} onApply={filters=>setExplorer(cur=>({...cur,page:1,filters}))}/>
    <ProductDialog key={editing?.id??'new'} open={dialog} onClose={()=>setDialog(false)} onSaved={load} product={editing}/>
  </div>;
}
