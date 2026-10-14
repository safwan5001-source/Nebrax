const fs=require('fs');const {chromium}=require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const BASE=process.env.BASE||'http://127.0.0.1:3001';
(async()=>{const b=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox']});
const c=await b.newContext({viewport:{width:1440,height:900}});
// Real login through the UI (server preference locale = ar)
if(process.env.TOKEN){/* token mode: avoids the 5/min login throttle; the account preference stays Arabic */await c.addCookies([{name:'locale',value:'ar',url:BASE}]);await c.addInitScript(({t,u})=>{if(!localStorage.getItem('token')){localStorage.setItem('token',t);localStorage.setItem('user',u)}},{t:process.env.TOKEN,u:process.env.USER_JSON});}
const p=await c.newPage();if(process.env.TOKEN){await p.goto(BASE+'/dashboard');await p.waitForTimeout(2500);}else{await p.goto(BASE+'/login');await p.waitForTimeout(1500);
await p.fill('input[type=email]',process.env.EMAIL);await p.fill('input[type=password]',process.env.PASSWORD);await p.keyboard.press('Enter');await p.waitForFunction(()=>location.pathname.startsWith('/dashboard'),null,{timeout:20000});await p.waitForTimeout(1500);}
const lang=async()=>p.evaluate(()=>document.documentElement.lang);
console.log('after login:',await lang());
await p.getByRole('button',{name:'تبديل اللغة'}).click();await p.waitForTimeout(2000);console.log('after toggle:',await lang());
await p.goto(BASE+'/invoices');await p.waitForTimeout(1500);console.log('/invoices:',await lang());
await p.goto(BASE+'/settings');await p.waitForTimeout(2500);console.log('/settings:',await lang());
await p.goto(BASE+'/invoices');await p.waitForTimeout(1500);console.log('/invoices after settings:',await lang());
const cookies=await c.cookies();console.log('locale cookie:',cookies.find(x=>x.name==='locale')?.value);
await b.close()})();
