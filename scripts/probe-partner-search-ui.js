'use strict';
// Development-only probe: let the official Partner Center UI issue one search
// request and report only transport metadata. Creator rows, response bodies,
// cookie values and request signatures are never printed or stored.
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {launchRealWindow}=require('../lib/browser');
const {toPuppeteerCookies}=require('../lib/cookies');
const Accounts=require('../lib/account-cookies');
const {codes}=require('../lib/partner-markets');
const {frontend}=require('../lib/partner-browser');

const [cookieFile,region='MY',approval]=process.argv.slice(2);
const timeout=(promise,ms)=>Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(new Error('TIMEOUT')),ms))]);

async function main(){
  if(approval!=='--observe-one-search'||!cookieFile||!Object.hasOwn(codes,region)) throw new Error('Explicit file, market and --observe-one-search required');
  const cookies=Accounts.parse(fs.readFileSync(path.resolve(cookieFile),'utf8').replace(/^\uFEFF/,''));
  const opened=await launchRealWindow(null,false,{background:true});
  const {browser}=opened;let result={region,creatorDataRead:false,cookieValuesLogged:false,requestSignaturesLogged:false};
  const observed=[];
  try{
    await browser.defaultBrowserContext().setCookie(...toPuppeteerCookies(cookies));
    const page=await browser.newPage(),started=Date.now();
    const responsePromise=new Promise(resolve=>page.on('response',response=>{
      try{
        const url=new URL(response.url()),request=response.request();
        if(!url.pathname.endsWith('/4partner/find')||request.method()!=='POST')return;
        const body=JSON.parse(request.postData()||'{}'),matchingPaths=[];
        const visit=(value,current='')=>{
          if(value==='phone case')matchingPaths.push(current);
          else if(value&&typeof value==='object')for(const [key,child] of Object.entries(value))visit(child,current?current+'.'+key:key);
        };
        visit(body);observed.push({topLevelKeys:Object.keys(body).sort(),matchingPaths,
          queryKind:typeof body.query!=='string'?'non-string':body.query==='phone case'?'target':body.query?'other':'blank',
          queryLength:typeof body.query==='string'?body.query.length:null});
        if(!matchingPaths.length)return;
        resolve({status:response.status(),challenge:Object.keys(response.headers()).some(key=>key.toLowerCase()==='bdturing-verify'),
          queryMatched:true,page:Number(body.pagination?.page||0),durationMs:Date.now()-started});
      }catch(_){resolve({parseError:true});}
    }));
    await page.goto(frontend(region)+'/affiliate-cmp/creator?market='+codes[region],{waitUntil:'domcontentloaded',timeout:60000});
    await new Promise(resolve=>setTimeout(resolve,5000));
    const state=await page.evaluate(()=>({
      login:[...document.querySelectorAll('input')].some(node=>node.type==='password'&&node.getClientRects().length),
      challenge:[...document.querySelectorAll('[id*="captcha"], [class*="captcha_verify"], iframe[src*="captcha"], iframe[title*="aptcha"]')].some(node=>node.getClientRects().length),
      search:[...document.querySelectorAll('input')].map((node,index)=>({index,type:node.type,placeholder:node.placeholder||'',aria:node.getAttribute('aria-label')||'',visible:node.getClientRects().length>0&&!node.disabled}))
        .find(item=>item.visible&&(item.type==='search'||/search|搜索/i.test(item.placeholder+' '+item.aria)))||null
    }));
    result={...result,login:state.login,visibleChallenge:state.challenge,searchInputFound:!!state.search};
    if(!state.login&&!state.challenge&&state.search){
      const inputs=await page.$$('input');const input=inputs[state.search.index];
      await input.evaluate(node=>{
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,'phone case');
        node.dispatchEvent(new Event('input',{bubbles:true}));
      });
      await new Promise(resolve=>setTimeout(resolve,500));
      result.typedValueMatched=await input.evaluate(node=>node.value==='phone case');
      await input.evaluate(node=>{
        node.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true}));
        node.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true}));
      });
      try { result={...result,...await timeout(responsePromise,30000)}; }
      catch(error) { result={...result,requestObserved:false,error:error.message}; }
    }
    result.findRequestsObserved=observed.length;
    result.findRequestShapes=observed.slice(-5);
    console.log(JSON.stringify(result));
  } finally {
    await browser.close().catch(()=>{});
    const resolved=path.resolve(opened.profileDir||''),temp=path.resolve(os.tmpdir())+path.sep;
    if(opened.profileDir&&resolved.startsWith(temp)&&path.basename(resolved).startsWith('tiktok-pack-profile-'))fs.rmSync(resolved,{recursive:true,force:true});
  }
}
main().catch(error=>{console.log(JSON.stringify({error:error.message,creatorDataRead:false,cookieValuesLogged:false,requestSignaturesLogged:false}));process.exitCode=1;});
