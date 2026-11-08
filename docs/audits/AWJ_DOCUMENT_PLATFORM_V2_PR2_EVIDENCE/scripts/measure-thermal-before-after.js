// usage: node measure-thermal.js <outdir>   (dev server on :3001, QA page with thermal templates)
const { chromium } = require('playwright'); const fs=require('fs'); const {execSync}=require('child_process');
const OUT=process.argv[2]; fs.mkdirSync(OUT,{recursive:true});
const rows=[];
function pdfinfo(f){const i=execSync(`pdfinfo "${f}"`).toString();const m=/Page size:\s+([\d.]+) x ([\d.]+) pts/.exec(i);return {pages:+/Pages:\s+(\d+)/.exec(i)[1],wMm:+(m[1]*25.4/72).toFixed(1),hMm:+(m[2]*25.4/72).toFixed(1),bytes:fs.statSync(f).size,textChars:execSync(`pdftotext "${f}" - | wc -c`).toString().trim()*1};}
(async()=>{
 const b=await chromium.launch({args:['--no-sandbox']});
 for (const w of [58,80]) for (const scenario of ['single','five','twenty','long_content']) for (const dir of ['rtl','ltr']) {
  const tag=`${w}_${scenario}_${dir}`;
  const c=await b.newContext({viewport:{width:1280,height:1000},acceptDownloads:true});
  await c.addCookies([{name:'locale',value:dir==='ltr'?'en':'ar',url:'http://127.0.0.1:3001'}]);
  const p=await c.newPage();
  await p.addInitScript(()=>{window.print=()=>{window.__style=document.getElementById('nebrax-doc-print-page')?.textContent??null;};});
  await p.goto(`http://127.0.0.1:3001/document-qa?${new URLSearchParams({type:'simplified_tax_invoice',template:`tax-invoice-thermal${w}`,scenario,direction:dir,qr:'on',logo:'on',assets:'on'})}`,{waitUntil:'networkidle',timeout:120000});
  await p.waitForSelector('#qa-print-root'); await p.evaluate(()=>document.fonts.ready);
  const m=await p.evaluate(()=>{
    const root=document.getElementById('qa-print-root'); const rr=root.getBoundingClientRect();
    const all=[...root.querySelectorAll('*')];
    const ellipsis=all.filter(e=>getComputedStyle(e).textOverflow==='ellipsis');
    const clipped=ellipsis.filter(e=>e.scrollWidth>e.clientWidth+1).length;
    const outside=all.filter(e=>{const r=e.getBoundingClientRect(); return r.width>0 && (r.right>rr.right+1||r.left<rr.left-1);}).length;
    const amounts=[...root.querySelectorAll('.num')].filter(e=>/\d/.test(e.textContent||''));
    const spread=e=>{const t=[...e.getClientRects()].map(r=>r.top);return t.length?Math.max(...t)-Math.min(...t):0;};
    const wrappedAmounts=amounts.filter(e=>spread(e)>4).length;
    // a row whose label wrapped but amount stayed on one line is fine; report rows where grand-total label and amount sit on different lines
    const totalRows=[...root.querySelectorAll('div.flex.justify-between')].filter(d=>/text-\[13px\]/.test(d.className));
    const brokenTotals=totalRows.filter(d=>{const k=[...d.children].map(c=>c.getBoundingClientRect());return k.length>=2 && Math.abs(k[0].bottom-k[1].bottom)>k[1].height+4;}).length;
    // total row: grand total label + amount on different lines?
    return {wMm:+(rr.width*25.4/96).toFixed(1),hMm:+(rr.height*25.4/96).toFixed(1),ellipsisEls:ellipsis.length,clippedByEllipsis:clipped,outside,amounts:amounts.length,wrappedAmounts,brokenTotals,totalRows:totalRows.length};
  });
  await p.locator('#qa-print-root').screenshot({path:`${OUT}/screen_${tag}.png`});
  await p.getByTestId('qa-print').click();
  const style=await p.evaluate(()=>window.__style);
  await p.emulateMedia({media:'print'});
  const pf=`${OUT}/print_${tag}.pdf`; await p.pdf({path:pf,preferCSSPageSize:true,printBackground:true});
  await p.emulateMedia({media:'screen'});
  const [dl]=await Promise.all([p.waitForEvent('download'),p.getByTestId('qa-download-pdf').click()]);
  const ef=`${OUT}/export_${tag}.pdf`; await dl.saveAs(ef);
  const row={tag,preview:m,injectedStyle:style,print:pdfinfo(pf),exportPdf:pdfinfo(ef)};
  rows.push(row); console.log(JSON.stringify(row));
  await c.close();
 }
 fs.writeFileSync(`${OUT}/results.json`,JSON.stringify(rows,null,1));
 await b.close();
})();
