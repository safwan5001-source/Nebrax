import json,re,collections,sys
R=json.load(open('results.json')); T=json.load(open('texts.json'))
def dg(s): return s.translate(str.maketrans('٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹','01234567890123456789')).replace('٫','.').replace('٬',',')
def money(s): return [round(float(x.replace(',',''))*100) for x in re.findall(r'\d[\d,]*\.\d\d',dg(s))]
DISC={'خصم الفاتورة','Invoice discount'}
fails=collections.defaultdict(list); checked=collections.Counter()
for r in R:
    k=(r['group'],r['template'].replace('tax-invoice-',''),r.get('layout','default'),r['scenario'],r['lang'])
    # layout health
    for key in ('clipped','outside','overlaps','wordTooWide'):
        if r.get(key): fails[k].append(f'{key}={r[key][:2]}')
    if r['scrollW']>r['clientW']+1: fails[k].append('h-overflow')
    if r['group'] in ('a4','a4-compositions','saved-layout'):
        tot=money(r['totals']); lay=r.get('layout')
        if lay is None:
            checked['a4-default']+=1
            if len(r['headers'])!=9: fails[k].append(f"columns={len(r['headers'])}")
            for row in r['rows']:
                m=[money(c) for c in row[3:]]
                net,tax,total=[m[i][0] if m[i] else None for i in (2,4,5)]
                if None in (net,tax,total): fails[k].append(f'cell missing {row}'); continue
                if net+tax!=total: fails[k].append(f'row {net}+{tax}!={total}')
            if r['scenario']!='historical' and r['scenario']!='rounding': pass
            if r['discountNote'] is not None: fails[k].append('unexpected discount note on default layout')
        else:
            checked['a4-saved']+=1
            hasdisc = any('discount' in (l or '').lower() or 'خصم' in (l or '') for l in r['headers'])
            if hasdisc: fails[k].append('saved layout unexpectedly shows discount column')
            if r['scenario'] in ('line_discount','header_discount') and not r['discountNote']: fails[k].append('discounted rows unexplained (no note)')
        if len(tot)==4:
            if tot[0]-tot[1]+tot[2]!=tot[3]: fails[k].append(f'totals {tot}')
        elif len(tot)==3:
            if tot[0]+tot[1]!=tot[2]: fails[k].append(f'totals {tot}')
        else: fails[k].append(f'totals? {tot}')
        s=sum(money(row[-1])[0] for row in r['rows'])
        if s!=tot[-1]: fails[k].append(f'sum rows {s}!={tot[-1]}')
    else:
        checked['thermal']+=1
        lines=[l.strip() for l in dg(T[r['file']]).split('\n') if l.strip()]
        # totals block = the trailing 'label\nvalue' pairs ending with the grand total
        idx=[i for i,l in enumerate(lines) if re.search(r'^(Subtotal|المجموع قبل الضريبة)',l)][0]
        pairs=[]; i=idx
        while i<len(lines)-1 and len(pairs)<4:
            lab,val=lines[i],lines[i+1]
            if money(val): pairs.append((lab,money(val)[0],'−' in val)); i+=2
            else: break
        vals=[p[1] for p in pairs]
        has=any(p[0] in DISC for p in pairs)
        ok=(vals[0]-vals[1]+vals[2]==vals[3]) if has else (vals[0]+vals[1]==vals[2])
        if has and len(vals)!=4: ok=False
        if not ok: fails[k].append(f'THERMAL totals do not reconcile {pairs}')
        lab_vat=[p[0] for p in pairs if 'VAT' in p[0] or 'القيمة المضافة' in p[0]]
        if r['scenario']=='vat5' and not any('5%' in l and '15%' not in l for l in lab_vat): fails[k].append(f'vat5 label {lab_vat}')
        if r['scenario'] in('line_discount','header_discount','long_names','many_lines') and not has: fails[k].append('discount row missing')
print('checked',dict(checked),'| cases',len(R),'| with failures',len(fails))
for k,v in fails.items(): print(k,v[:3])
