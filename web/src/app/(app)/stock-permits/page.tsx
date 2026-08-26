'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import { AdvancedFilterDialog } from '@/components/data-explorer/advanced-filter-dialog';
import { DataTable } from '@/components/data-table';
import { ListToolbar, PageHeader, Pagination, type PageAction, type SortOption } from '@/components/nebrax';
import { Badge } from '@/components/ui/badge';
import { BranchViewToggle } from '@/components/ui/branch-view-toggle';
import { api } from '@/lib/api';
import { branchViewQuery, type BranchView } from '@/lib/branch-view';
import type { ActiveFilter, DataExplorerState, FilterDefinition } from '@/lib/data-explorer/types';
import { parseExplorerState, removeFilter, replaceFilter, serializeExplorerState } from '@/lib/data-explorer/url-state';
import { formatRiyal } from '@/lib/money';

interface StockPermit { id:string; type:'receipt'|'issue'|'transfer'; number:string; warehouse_name:string|null; target_warehouse_name:string|null; permit_date:string; status:string; reason:string|null; total_cost:string }
const typeTone: Record<StockPermit['type'], 'positive'|'muted'|'negative'> = { receipt:'positive', issue:'negative', transfer:'muted' };
const filterValue=(f?:ActiveFilter)=>!f||Array.isArray(f.value)?'':String(f.value).trim();
const emptyFilter=(f:ActiveFilter)=>Array.isArray(f.value)?f.value.every(v=>String(v).trim()===''):String(f.value).trim()==='';

export default function StockPermitsPage(){
 const t=useTranslations('stockPermits'); const router=useRouter(); const searchParams=useSearchParams();
 const [explorer,setExplorer]=useState<DataExplorerState>(()=>{const p=parseExplorerState(new URLSearchParams(searchParams.toString()));return {...p,perPage:p.perPage??25,sort:p.sort??'-permit_date'}});
 const [searchInput,setSearchInput]=useState(explorer.search); const [advancedOpen,setAdvancedOpen]=useState(false); const [data,setData]=useState<StockPermit[]>([]); const [loading,setLoading]=useState(true); const [view,setView]=useState<BranchView>('current');
 const load=useCallback(()=>{setLoading(true);api<{data:StockPermit[]}>(`/stock-permits${branchViewQuery(view)}`).then(r=>setData(r.data)).finally(()=>setLoading(false));},[view]);
 useEffect(()=>load(),[load]);
 useEffect(()=>{const timer=window.setTimeout(()=>setExplorer(c=>c.search===searchInput?c:{...c,search:searchInput,page:1}),300);return()=>window.clearTimeout(timer);},[searchInput]);
 useEffect(()=>{const url=serializeExplorerState(explorer);router.replace(url.toString()?`/stock-permits?${url.toString()}`:'/stock-permits',{scroll:false});},[explorer,router]);
 const warehouses=useMemo(()=>Array.from(new Set(data.flatMap(x=>[x.warehouse_name,x.target_warehouse_name]).filter((v):v is string=>Boolean(v)))).sort((a,b)=>a.localeCompare(b,'ar')).map(v=>({value:v,label:v})),[data]);
 const statuses=useMemo(()=>Array.from(new Set(data.map(x=>x.status))).sort().map(v=>({value:v,label:t(v)})),[data,t]);
 const definitions=useMemo<FilterDefinition[]>(()=>[
  {key:'warehouse',label:t('warehouse'),kind:'entity',quick:true,searchPlaceholder:t('search'),emptyText:t('empty'),options:warehouses},
  {key:'type',label:t('type'),kind:'select',quick:true,options:['receipt','issue','transfer'].map(v=>({value:v,label:t(`type_${v}`)}))},
  {key:'status',label:t('status'),kind:'select',quick:true,options:statuses},
  {key:'date_from',label:`${t('date')} ≥`,kind:'date'},{key:'date_to',label:`${t('date')} ≤`,kind:'date'},
  {key:'cost_min',label:`${t('total_cost')} ≥`,kind:'money'},{key:'cost_max',label:`${t('total_cost')} ≤`,kind:'money'},
 ],[statuses,t,warehouses]);
 const labelled=useMemo(()=>explorer.filters.map(f=>({...f,label:definitions.find(d=>d.key===f.key)?.label??f.label})),[definitions,explorer.filters]);
 const filtered=useMemo(()=>{const fs=new Map(explorer.filters.map(f=>[f.key,f]));const q=explorer.search.trim().toLocaleLowerCase();const wh=filterValue(fs.get('warehouse')),type=filterValue(fs.get('type')),status=filterValue(fs.get('status')),from=filterValue(fs.get('date_from')),to=filterValue(fs.get('date_to')),minT=filterValue(fs.get('cost_min')),maxT=filterValue(fs.get('cost_max')),min=Number(minT),max=Number(maxT);
  return data.filter(x=>{if(q&&![x.number,x.warehouse_name,x.target_warehouse_name,x.reason,x.status,x.type].filter(Boolean).join(' ').toLocaleLowerCase().includes(q))return false;if(wh&&x.warehouse_name!==wh&&x.target_warehouse_name!==wh)return false;if(type&&x.type!==type)return false;if(status&&x.status!==status)return false;if(from&&x.permit_date<from)return false;if(to&&x.permit_date>to)return false;const cost=Number(x.total_cost);if(minT&&Number.isFinite(min)&&cost<min)return false;if(maxT&&Number.isFinite(max)&&cost>max)return false;return true;});},[data,explorer.filters,explorer.search]);
 const sorted=useMemo(()=>{const n=[...filtered],sort=explorer.sort??'-permit_date',desc=sort.startsWith('-'),key=sort.replace(/^-/,'');n.sort((a,b)=>{let c=0;if(key==='number')c=a.number.localeCompare(b.number,'ar',{numeric:true});else if(key==='warehouse')c=(a.warehouse_name??'').localeCompare(b.warehouse_name??'','ar');else if(key==='type')c=a.type.localeCompare(b.type);else if(key==='total_cost')c=Number(a.total_cost)-Number(b.total_cost);else if(key==='status')c=a.status.localeCompare(b.status);else c=a.permit_date.localeCompare(b.permit_date);return desc?-c:c});return n;},[explorer.sort,filtered]);
 const perPage=explorer.perPage??25,totalPages=Math.max(1,Math.ceil(sorted.length/perPage)),page=Math.min(explorer.page??1,totalPages),pageData=sorted.slice((page-1)*perPage,page*perPage);
 const updateFilter=(next:ActiveFilter)=>setExplorer(c=>({...c,page:1,filters:emptyFilter(next)?removeFilter(c.filters,next.key):replaceFilter(c.filters,next)}));
 const columns=useMemo<ColumnDef<StockPermit,unknown>[]>(()=>[
  {accessorKey:'number',header:t('number'),cell:({row})=><Link href={`/stock-permits/${row.original.id}`} className="num text-primary hover:underline">{row.original.number}</Link>},
  {accessorKey:'type',header:t('type'),cell:({row})=><Badge tone={typeTone[row.original.type]}>{t(`type_${row.original.type}`)}</Badge>},
  {id:'warehouse',header:t('warehouse'),accessorFn:r=>r.warehouse_name??'—',cell:({row})=><span className="text-text">{row.original.warehouse_name??'—'}{row.original.target_warehouse_name&&<span className="text-muted"> ← {row.original.target_warehouse_name}</span>}</span>},
  {accessorKey:'permit_date',header:t('date'),cell:({row})=><span className="num text-muted">{row.original.permit_date}</span>},
  {accessorKey:'total_cost',header:t('total_cost'),cell:({row})=><div className="num text-end">{formatRiyal(row.original.total_cost)}</div>},
  {accessorKey:'status',header:t('status'),cell:({row})=><Badge tone={row.original.status==='posted'?'positive':'muted'}>{t(row.original.status)}</Badge>},
 ],[t]);
 const sortOptions:SortOption[]=[{value:'-permit_date',label:`${t('date')} ↓`},{value:'permit_date',label:`${t('date')} ↑`},{value:'number',label:t('number')},{value:'warehouse',label:t('warehouse')},{value:'type',label:t('type')},{value:'-total_cost',label:`${t('total_cost')} ↓`},{value:'total_cost',label:`${t('total_cost')} ↑`},{value:'status',label:t('status')}];
 const actions:PageAction[]=[{key:'create',label:t('create'),icon:Plus,href:'/stock-permits/new',variant:'primary'}];
 return <div className="space-y-4">
  <PageHeader title={t('title')} context={<BranchViewToggle value={view} onChange={next=>{setView(next);setExplorer(c=>({...c,page:1}))}}/>} actions={actions}/>
  <ListToolbar search={searchInput} searchPlaceholder={t('search')} searchLabel={t('title')} onSearchChange={setSearchInput} definitions={definitions} filters={labelled} onFilterChange={updateFilter} onRemoveFilter={key=>setExplorer(c=>({...c,page:1,filters:removeFilter(c.filters,key)}))} onClearFilters={()=>setExplorer(c=>({...c,page:1,filters:[]}))} onOpenAdvanced={()=>setAdvancedOpen(true)} sort={{value:explorer.sort??'-permit_date',onChange:value=>setExplorer(c=>({...c,page:1,sort:value})),options:sortOptions}} resultCount={sorted.length} totalCount={data.length}/>
  <DataTable columns={columns} data={pageData} loading={loading} emptyLabel={t('empty')} exportName="stock-permits" showToolbar={false} mobileRecord={x=>({title:<Link href={`/stock-permits/${x.id}`} className="num text-primary hover:underline">{x.number}</Link>,subtitle:x.warehouse_name??'—',caption:x.target_warehouse_name??undefined,amountLabel:t('total_cost'),amount:formatRiyal(x.total_cost),badge:<Badge tone={typeTone[x.type]}>{t(`type_${x.type}`)}</Badge>,status:<Badge tone={x.status==='posted'?'positive':'muted'}>{t(x.status)}</Badge>,meta:x.permit_date})}/>
  <Pagination page={page} lastPage={totalPages} perPage={perPage} total={sorted.length} disabled={loading} onPageChange={next=>setExplorer(c=>({...c,page:next}))} onPerPageChange={next=>setExplorer(c=>({...c,page:1,perPage:next}))}/>
  <AdvancedFilterDialog open={advancedOpen} onClose={()=>setAdvancedOpen(false)} definitions={definitions} filters={labelled} onApply={filters=>setExplorer(c=>({...c,page:1,filters}))}/>
 </div>;
}
