import { chromium } from '@playwright/test';
const base='http://127.0.0.1:3001', out=process.argv[2];
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
for (const [name,theme,mode] of [['core-light','core','light'],['default-light','default','light'],['ink-light','ink','light'],['default-dark','default','dark'],['ink-dark','ink','dark']]) {
  const ctx=await b.newContext({viewport:{width:1440,height:900}}); await ctx.addCookies([{name:'locale',value:'ar',url:base}]);
  await ctx.addInitScript(([theme,mode])=>{localStorage.setItem('demo','true');localStorage.setItem('user',JSON.stringify({id:'demo-user',name:'مستخدم المعاينة',email:'demo@nibras.test',role:'owner',permissions:['*'],tenant_id:'demo-tenant'}));localStorage.setItem('theme',mode);if(theme!=='default')localStorage.setItem('awj:theme',theme);},[theme,mode]);
  const p=await ctx.newPage(); await p.goto(`${base}/dashboard?awj-ui=3`,{waitUntil:'load'}); await p.waitForLoadState('networkidle').catch(()=>{}); await p.waitForTimeout(1200);
  const m=await p.evaluate(()=>({side:getComputedStyle(document.querySelector('[data-awj-shell="sidebar"]')).backgroundColor,top:getComputedStyle(document.querySelector('[data-awj-shell="topbar"]')).backgroundColor}));
  console.log(name,JSON.stringify(m)); await p.screenshot({path:`${out}/${name}-ar-desktop-dashboard.png`}); await ctx.close();
}
await b.close();
