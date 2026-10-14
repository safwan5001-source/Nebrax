const {chromium}=require('/home/user/Nebrax/web/node_modules/playwright-core');
const route=process.argv[2], btn=process.argv[3], locale=process.argv[4]||'en', width=+(process.argv[5]||1440);
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
const c=await b.newContext({viewport:{width,height:900}});await c.addCookies([{name:'locale',value:locale,url:'http://127.0.0.1:3001'}]);
await c.addInitScript(({t,u})=>{localStorage.setItem('token',t);localStorage.setItem('user',u);localStorage.setItem('awj:ui-version','3')},{t:process.env.TOKEN,u:require('fs').readFileSync(__dirname+'/../user.json','utf8')});
const p=await c.newPage();await p.goto('http://127.0.0.1:3001'+route);await p.waitForTimeout(2500);
const trigger=p.getByRole('button',{name:new RegExp(btn)}).first();await trigger.focus();await p.keyboard.press('Enter');await p.waitForTimeout(600);
const info=await p.evaluate(()=>{const d=document.querySelector('[role=dialog]');const a=document.activeElement;return {dialog:!!d,label:d?.getAttribute('aria-label'),closeName:d?.querySelector('button[aria-label]')?.getAttribute('aria-label'),activeInDialog:!!(d&&d.contains(a)),active:a?.tagName+':'+(a?.getAttribute('aria-label')||a?.textContent||'').trim().slice(0,30),bodyOverflow:getComputedStyle(document.body).overflow}});
console.log('after open',JSON.stringify(info));
let escaped=0;for(let i=0;i<40;i++){await p.keyboard.press('Tab');const inD=await p.evaluate(()=>{const d=document.querySelector('[role=dialog]');return !!(d&&d.contains(document.activeElement))});if(!inD)escaped++;}
console.log('tabs outside dialog (of 40):',escaped);
await p.keyboard.press('Escape');await p.waitForTimeout(300);
console.log('after Escape: dialog?',await p.evaluate(()=>!!document.querySelector('[role=dialog]')),'focus:',await p.evaluate(()=>{const a=document.activeElement;return a?.tagName+':'+(a?.textContent||'').trim().slice(0,30)}));
await b.close()})();
