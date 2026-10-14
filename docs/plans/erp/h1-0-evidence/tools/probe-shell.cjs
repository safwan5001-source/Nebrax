const {chromium}=require('/home/user/Nebrax/web/node_modules/playwright-core');
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
const c=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await c.addCookies([{name:'locale',value:'ar',url:'http://127.0.0.1:3001'}]);
await c.addInitScript(({t,u})=>{localStorage.setItem('token',t);localStorage.setItem('user',u);localStorage.setItem('awj:ui-version','3')},{t:process.env.TOKEN,u:require('fs').readFileSync(__dirname+'/../user.json','utf8')});
const p=await c.newPage();await p.goto('http://127.0.0.1:3001/invoices');await p.waitForTimeout(2500);
// first 5 tab stops
const stops=[];for(let i=0;i<6;i++){await p.keyboard.press('Tab');stops.push(await p.evaluate(()=>{const a=document.activeElement;return a.tagName+':'+(a.getAttribute('aria-label')||a.textContent||'').trim().slice(0,25)}));}
console.log('mobile first tab stops:',stops.join(' | '));
const menu=p.locator('header button').first();console.log('menu label:',await menu.getAttribute('aria-label'), 'expanded:',await menu.getAttribute('aria-expanded'));
await menu.click();await p.waitForTimeout(500);
console.log('after open focus:',await p.evaluate(()=>{const a=document.activeElement;return a.tagName+':'+(a.getAttribute('aria-label')||a.textContent||'').trim().slice(0,25)+' inAside='+!!a.closest('aside')}));
let out=0;for(let i=0;i<30;i++){await p.keyboard.press('Tab');if(!(await p.evaluate(()=>!!document.activeElement.closest('aside'))))out++;}console.log('drawer tabs escaping (of 30):',out);
await p.keyboard.press('Escape');await p.waitForTimeout(400);
console.log('after Esc focus:',await p.evaluate(()=>{const a=document.activeElement;return a.tagName+':'+(a.getAttribute('aria-label')||'').slice(0,25)}),'drawer visible:',await p.evaluate(()=>{const r=document.querySelector('aside')?.getBoundingClientRect();return r?Math.round(r.left)+'..'+Math.round(r.right):'none'}));
// desktop skip link
const d=await c.browser().newContext({viewport:{width:1440,height:900}});await d.addCookies([{name:'locale',value:'ar',url:'http://127.0.0.1:3001'}]);await d.addInitScript(({t,u})=>{localStorage.setItem('token',t);localStorage.setItem('user',u);localStorage.setItem('awj:ui-version','3')},{t:process.env.TOKEN,u:require('fs').readFileSync(__dirname+'/../user.json','utf8')});
const q=await d.newPage();await q.goto('http://127.0.0.1:3001/invoices');await q.waitForTimeout(2500);
let n=0;for(;n<150;n++){await q.keyboard.press('Tab');const inMain=await q.evaluate(()=>!!document.activeElement.closest('main'));if(inMain)break;}console.log('desktop Tab presses to reach main content:',n+1);
await q.goto('http://127.0.0.1:3001/cheques');await q.waitForTimeout(2000);console.log('/cheques h1:',await q.evaluate(()=>document.querySelector('h1')?.textContent),'text:',await q.evaluate(()=>document.querySelector('main')?.innerText.slice(0,120)));
await b.close()})();
