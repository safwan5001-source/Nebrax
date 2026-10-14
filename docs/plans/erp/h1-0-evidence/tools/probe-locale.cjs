const fs=require('fs');const {chromium}=require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const BASE=process.env.BASE||'http://127.0.0.1:3001';
(async()=>{const b=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox']});
const c=await b.newContext({viewport:{width:1440,height:900}});
// Real login through the UI (server preference locale = ar)
const p=await c.newPage();await p.goto(BASE+'/login');await p.waitForTimeout(1500);
await p.fill('input[type=email]',process.env.EMAIL);await p.fill('input[type=password]',process.env.PASSWORD);await p.keyboard.press('Enter');await p.waitForURL(/dashboard/,{timeout:15000});await p.waitForTimeout(1500);
const lang=async()=>p.evaluate(()=>document.documentElement.lang);
console.log('after login:',await lang());
await p.getByRole('button',{name:'تبديل اللغة'}).click();await p.waitForTimeout(2000);console.log('after toggle:',await lang());
await p.goto(BASE+'/invoices');await p.waitForTimeout(1500);console.log('/invoices:',await lang());
await p.goto(BASE+'/settings');await p.waitForTimeout(2500);console.log('/settings:',await lang());
await p.goto(BASE+'/invoices');await p.waitForTimeout(1500);console.log('/invoices after settings:',await lang());
const cookies=await c.cookies();console.log('locale cookie:',cookies.find(x=>x.name==='locale')?.value);
await b.close()})();
