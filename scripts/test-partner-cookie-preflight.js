'use strict';
// Read-only preflight of the user-provided Partner Cookie in an isolated browser.
const fs=require('node:fs'),path=require('node:path');
const {launchRealWindow}=require('../lib/browser');
const {loadCookies,toPuppeteerCookies}=require('../lib/cookies');
async function main(){
  const source=process.argv[2]||'C:/Users/Huawei/Desktop/json.txt';
  const detailUrl=process.argv[3]||'';
  const out=path.resolve('test-results','partner-cookie-preflight-'+Date.now());
  fs.mkdirSync(out,{recursive:true});
  const report={cookieSource:'provided_desktop_file',openedChatPages:0,network:[]};
  let browser;
  try{
    const opened=await launchRealWindow(source,true);browser=opened.browser;
    const cookies=toPuppeteerCookies(loadCookies(source));
    await browser.defaultBrowserContext().setCookie(...cookies);
    const imported=await browser.defaultBrowserContext().cookies();
    report.inputCookies=cookies.length;report.importedCookies=imported.length;
    report.allValuesMatch=cookies.every(c=>imported.some(i=>i.name===c.name&&i.domain===c.domain&&i.value===c.value));
    const page=await browser.newPage();
    const pending=[];
    page.on('response',res=>{
      const url=new URL(res.url());
      if(!url.hostname.endsWith('tiktokshop.com')||!url.pathname.includes('/api')||!/(creator|partner\/info)/.test(url.pathname))return;
      pending.push((async()=>{
      const item={origin:url.origin,path:url.pathname,httpStatus:res.status()};
      if(url.pathname.endsWith('/4partner/find')){
        try{
          const body=JSON.parse(res.request().postData()||'{}');
          item.request={topLevelKeys:Object.keys(body),queryType:body.query_type,algorithm:body.algorithm,
            filterParamsType:Array.isArray(body.filter_params)?'array':typeof body.filter_params,
            filterParamKeys:body.filter_params&&typeof body.filter_params==='object'?Object.keys(body.filter_params):[],
            paginationKeys:body.pagination&&typeof body.pagination==='object'?Object.keys(body.pagination):[],
            page:body.pagination?.page,size:body.pagination?.size,hasSearchKey:!!body.pagination?.search_key,
            queryParamNames:[...url.searchParams.keys()].filter(k=>!/(token|signature|bogus|bsid)/i.test(k))};
        }catch(_){item.request={invalidJson:true};}
      }
      if(url.pathname.endsWith('/4partner/profile')){
        try{const body=JSON.parse(res.request().postData()||'{}');item.request={profileTypes:body.profile_types||[],queryParamNames:[...url.searchParams.keys()].filter(k=>!/(token|signature|bogus|bsid)/i.test(k))};}catch(_){}
      }
        try{
          const json=await res.json();item.businessCode=json.code;item.topLevelKeys=Object.keys(json);
          const rows=json.creator_profile_list||json.data?.creator_profile_list;
          if(Array.isArray(rows)){
            item.creatorCount=rows.length;item.fieldNames=[...new Set(rows.flatMap(r=>Object.keys(r)))];
            item.regions=[...new Set(rows.map(r=>r.selection_region?.value||r.selection_region||null))];
            // Private, local replay contract only; never print IDs, cookies, or values.
            fs.writeFileSync(path.join(out,'observed-list-contract.private.json'),JSON.stringify({url:res.url(),method:res.request().method(),body:res.request().postData(),response:json}));
          }
          const profile=json.creator_profile||json.data?.creator_profile;
          if(profile&&typeof profile==='object'){
            item.profileFieldNames=Object.keys(profile);
            const types=item.request?.profileTypes||[];
            fs.writeFileSync(path.join(out,'observed-profile-'+types.join('-')+'.private.json'),JSON.stringify({url:res.url(),method:res.request().method(),body:res.request().postData(),response:json}));
          }
        }catch(_){}
        report.network.push(item);
      })());
    });
    await page.goto('https://partner.tiktokshop.com/affiliate-cmp/creator?market=6',{waitUntil:'domcontentloaded',timeout:60000});
    await new Promise(r=>setTimeout(r,12000));
    report.page=await page.evaluate(()=>({origin:location.origin,path:location.pathname,hasPasswordInput:!!document.querySelector('input[type=password]'),hasCreatorHeading:/查找达人|Find creators|Find Creators/.test(document.body?.innerText||''),hasVerification:/captcha|verify|checkpoint/i.test(location.pathname),textLength:document.body?.innerText.length||0}));
    if(detailUrl){
      const target=new URL(detailUrl);
      if(target.origin!=='https://partner.tiktokshop.com'||target.pathname!=='/affiliate-cmp/creator/detail')throw new Error('Invalid detail URL');
      await page.goto(target.href,{waitUntil:'domcontentloaded',timeout:60000});
      await new Promise(r=>setTimeout(r,15000));
      report.detailPage=await page.evaluate(()=>({path:location.pathname,hasPasswordInput:!!document.querySelector('input[type=password]'),textLength:document.body?.innerText.length||0}));
    }
    await Promise.allSettled(pending);
  }catch(e){report.error='PREFLIGHT_FAILED';}
  finally{
    if(browser)await browser.close().catch(()=>{});
    fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify({directory:out,...report}));
  }
}
main().catch(()=>{console.error('Local preflight failed');process.exitCode=1;});
