const {chromium}=require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const route=process.argv[2], w=+(process.argv[3]||1440);
(async()=>{const b=await chromium.launch({executablePath: process.env.CHROMIUM_PATH || undefined,args:['--no-sandbox']});
const c=await b.newContext({viewport:{width:w,height:900}});await c.addCookies([{name:'locale',value:'ar',url:'http://127.0.0.1:3001'}]);
await c.addInitScript(({t,u})=>{localStorage.setItem('token',t);localStorage.setItem('user',u);localStorage.setItem('awj:ui-version','3')},{t:process.env.TOKEN,u:require('fs').readFileSync(__dirname+'/../user.json','utf8')});
const p=await c.newPage();await p.goto('http://127.0.0.1:3001'+route);await p.waitForTimeout(3000);
console.log(await p.evaluate(()=>{const out=[];for(const e of document.querySelectorAll('body *')){const r=e.getBoundingClientRect();if(!r.width)continue;if(r.left<-1||r.right>innerWidth+1){if(getComputedStyle(e).position==='fixed')continue;const kids=[...e.children].some(k=>{const q=k.getBoundingClientRect();return q.width&&(q.left<-1||q.right>innerWidth+1)});if(!kids)out.push(e.tagName+'.'+String(e.className).slice(0,100)+' L='+Math.round(r.left)+' R='+Math.round(r.right)+' txt='+(e.textContent||'').trim().slice(0,30)+' name='+e.getAttribute('name')+' type='+e.getAttribute('type')+' id='+e.id+' parent='+String(e.parentElement.className).slice(0,80)+' gp='+String(e.parentElement.parentElement.className).slice(0,80))}}return {sw:document.documentElement.scrollWidth,out:out.slice(0,10)}}));
await b.close()})();
