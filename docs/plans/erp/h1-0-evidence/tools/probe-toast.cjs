const {chromium}=require('/home/user/Nebrax/web/node_modules/playwright-core');
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
for (const [w,loc] of [[320,'ar'],[320,'en'],[390,'ar']]){const c=await b.newContext({viewport:{width:w,height:640},isMobile:true});await c.addCookies([{name:'locale',value:loc,url:'http://127.0.0.1:3001'}]);
await c.addInitScript(({t,u})=>{localStorage.setItem('token',t);localStorage.setItem('user',u);localStorage.setItem('awj:ui-version','3')},{t:process.env.TOKEN,u:require('fs').readFileSync(__dirname+'/../user.json','utf8')});
const p=await c.newPage();await p.goto('http://127.0.0.1:3001/dashboard');await p.waitForTimeout(2500);
console.log(w,loc,await p.evaluate(()=>{const el=[...document.querySelectorAll('div.fixed')].find(d=>d.className.includes('max-w-sm'));if(!el)return 'no container';const r=el.getBoundingClientRect();return {left:Math.round(r.left),right:Math.round(r.right),width:Math.round(r.width),vw:document.documentElement.clientWidth}}));await c.close()}
await b.close()})();
