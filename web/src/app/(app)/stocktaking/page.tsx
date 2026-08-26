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

interface Stocktake { id:string; number:string; warehouse_name:string|null; stocktake_date:string; status:string; difference_value:string }
const filterValue=(f?:ActiveFilter)=>!f||Array.isArray(f.value)?'':String(f.value).trim();
const emptyFilter=(f:ActiveFilter)=>Array.isArray(f.value)?f.value.every(v=>String(v).trim()===''):String(f.value).trim()==='';

export default function StocktakingPage(){
 const t=useTranslations('stocktaking'); const router=useRouter(); const searchParams=useSearchParams();
 const [explorer,setExplorer]=useState<DataExplorerState>(()=>{const p=parseExplorerState(new URLSearchParams(searchParams.toString()));return {...p,perPage:p.perPage??25,sort:p.sort??'-stocktake_date'}});
 const [searchInput,setSearchInput]=useState(explorer.search); const [advancedOpen,setAdvancedOpen]=useState(false); const [data,setData]=useState<Stocktake[]>([]); const [loading,setLoading]=useState(true); const [view,setView]=useState<BranchView>('current');
 const load=useCallback(()=>{setLoading(true);api<{data:Stocktake[]}>(`/stocktakes${branchViewQuery(view)}`).then(r=>setData(r.data)).finally(()=>setLoading(false));},[view]);
 useEffect(()=>load(),[load]);
 useEffect(()=>{const timer=window.setTimeout(()=>setExplorer(c=>c.search===searchInput?c:{...c,search:searchInput,page:1}),300);return()=>window.clearTimeout(timer);},[searchInput]);
 useEffect(()=>{const url=serializeExplorerState(explorer);router.replace(url.toString()?`/stocktaking?${url.toString()}`:'/stocktaking',{scroll:false});},[explorer,router]);
 const warehouses=useMemo(()=>Array.from(new Set(data.map(x=>x.warehouse_name).filter((v):v is string=>Boolean(v)))).sort((a,b)=>a.localeCompare(b,'ar')).map(v=>({value:v,label:v})),[data]);
 const statuses=useMemo(()=>Array.from(new Set(data.map(x=>x.status))).sort().map(v=>({value:v,label:t(v)})),[data,t]);
 const definitions=useMemo<FilterDefinition[]>(()=>[
  {key:'warehouse',label:t('warehouse'),kind:'entity',quick:true,searchPlaceholder:t('search'),emptyText:t('empty'),options:warehouses},
  {key:'status',label:t('status'),kind:'select',quick:true,options:statuses},
  {key:'date_from',label:`${t('date')} ≥`,kind:'date'},{key:'date_to',label:`${t('date')} ≤`,kind:'date'},
  {key:'difference_min',label:`${t('difference')} ≥`,kind:'money'},{key:'difference_max',label:`${t('difference')} ≤`,kind:'money'},
 ],[statuses,t,warehouses]);
 const labelled=useMemo(()=>explorer.filters.map(f=>({...f,label:definitions.find(d=>d.key===f.key)?.label??f.label})),[definitions,explorer.filters]);
 const filtered=useMemo(()=>{const fs=new Map(explorer.filters.map(f=>[f.key,f]));const q=explorer.search.trim().toLocaleLowerCase(),wh=filterValue(fs.get('warehouse')),status=filterValue(fs.get('status')),from=filterValue(fs.get('date_from')),to=filterValue(fs.get('date_to')),minT=filterValue(fs.get('difference_min')),maxT=filterValue(fs.get('difference_max')),min=Number(minT),max=Number(maxT);
  return data.filter(x=>{if(q&&![x.number,x.warehouse_name,x.status].filter(Boolean).join(' ').toLocaleLowerCase().includes(q))return false;if(wh&&x.warehouse_name!==wh)return false;if(status&&x.status!==status)return false;if(from&&x.stocktake_date<from)return false;if(to&&x.stocktake_date>to)return false;const diff=Number(String(x.difference_value).replace(/,/g,''));if(minT&&Number.isFinite(min)&&diff<min)return false;if(maxT&&Number.isFinite(max)&&diff>max)return false;return true;});},[data,explorer.filters,explorer.search]);
 const sorted=useMemo(()=>{const n=[...filtered],sort=explorer.sort??'-stocktake_date',desc=sort.startsWith('-'),key=sort.replace(/^-/,'');n.sort((a,b)=>{let c=0;if(key==='number')c=a.number.localeCompare(b.number,'ar',{numeric:true});else if(key==='warehouse')c=(a.warehouse_name??'').localeCompare(b.warehouse_name??'','ar');else if(key==='difference')c=Number(String(a.difference_value).replace(/,/g,''))-Number(String(b.difference_value).replace(/,/g,''));else if(key==='status')c=a.status.localeCompare(b.status);else c=a.stocktake_date.localeCompare(b.stocktake_date);return desc?-c:c});return n;},[explorer.sort,filtered]);
 const perPage=explorer.perPage??25,totalPages=Math.max(1,Math.ceil(sorted.length/perPage)),page=Math.min(explorer.page??1,totalPages),pageData=sorted.slice((page-1)*perPage,page*perPage);
 const updateFilter=(next:ActiveFilter)=>setExplorer(c=>({...c,page:1,filters:emptyFilter(next)?removeFilter(c.filters,next.key):replaceFilter(c.filters,next)}));
 const columns=useMemo<ColumnDef<Stocktake,unknown>[]>(()=>[
  {accessorKey:'number',header:t('number'),cell:({row})=><Link href={`/stocktaking/${row.original.id}`} className="num text-primary hover:underline">{row.original.number}</Link>},
  {id:'warehouse',header:t('warehouse'),accessorFn:r=>r.warehouse_name??'—'},
  {accessorKey:'stocktake_date',header:t('date'),cell:({row})=><span className="num text-muted">{row.original.stocktake_date}</span>},
  {accessorKey:'difference_value',header:t('difference'),cell:({row})=>{const v=Number(String(row.original.difference_value).replace(/,/g,''));return <div className={`num text-end ${v<0?'text-negative':v>0?'text-positive':'text-muted'}`}>{formatRiyal(row.original.difference_value)}</div>}},
  {accessorKey:'status',header:t('status'),cell:({row})=><Badge tone={row.original.status==='posted'?'positive':'muted'}>{t(row.original.status)}</Badge>},
 ],[t]);
 const sortOptions:SortOption[]=[{value:'-stocktake_date',label:`${t('date')} ↓`},{value:'stocktake_date',label:`${t('date')} ↑`},{value:'number',label:t('number')},{value:'warehouse',label:t('warehouse')},{value:'-difference',label:`${t('difference')} ↓`},{value:'difference',label:`${t('difference')} ↑`},{value:'status',label:t('status')}];
 const actions:PageAction[]=[{key:'create',label:t('create'),icon:Plus,href:'/stocktaking/new',variant:'primary'}];
 return <div className="space-y-4">
  <PageHeader title={t('title')} context={<BranchViewToggle value={view} onChange={next=>{setView(next);setExplorer(c=>({...c,page:1}))}}/>} actions={actions}/>
  <ListToolbar search={searchInput} searchPlaceholder={t('search')} searchLabel={t('title')} onSearchChange={setSearchInput} definitions={definitions} filters={labelled} onFilterChange={updateFilter} onRemoveFilter={key=>setExplorer(c=>({...c,page:1,filters:removeFilter(c.filters,key)}))} onClearFilters={()=>setExplorer(c=>({...c,page:1,filters:[]}))} onOpenAdvanced={()=>setAdvancedOpen(true)} sort={{value:explorer.sort??'-stocktake_date',onChange:value=>setExplorer(c=>({...c,page:1,sort:value})),options:sortOptions}} resultCount={sorted.length} totalCount={data.length}/>
  <DataTable columns={columns} data={pageData} loading={loading} emptyLabel={t('empty')} exportName="stocktaking" showToolbar={false} mobileRecord={x=>({title:<Link href={`/stocktaking/${x.id}`} className="num text-primary hover:underline">{x.number}</Link>,subtitle:x.warehouse_name??'—',amountLabel:t('difference'),amount:formatRiyal(x.difference_value),status:<Badge tone={x.status==='posted'?'positive':'muted'}>{t(x.status)}</Badge>,meta:x.stocktake_date})}/>
  <Pagination page={page} lastPage={totalPages} perPage={perPage} total={sorted.length} disabled={loading} onPageChange={next=>setExplorer(c=>({...c,page:next}))} onPerPageChange={next=>setExplorer(c=>({...c,page:1,perPage:next}))}/>
  <AdvancedFilterDialog open={advancedOpen} onClose={()=>setAdvancedOpen(false)} definitions={definitions} filters={labelled} onApply={filters=>setExplorer(c=>({...c,page:1,filters}))}/>
 </div>;
}
