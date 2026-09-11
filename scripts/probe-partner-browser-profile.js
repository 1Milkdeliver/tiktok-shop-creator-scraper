'use strict';
// Opt-in ONE-page development probe. Uses a normal isolated Electron page and
// observes only that page's own profile responses. No request replay, masking,
// proxy, CAPTCHA solving, raw headers/cookies in output, or production DB writes.
const fs=require('fs'),path=require('path');
const {app,BrowserWindow,session}=require('electron');
const {cookieHeader,decodeResponse,ContactError}=require('../lib/partner-contacts');
const {permitted}=require('../lib/partner-profile');
const [cookieFile,pageUrl,output,consent]=process.argv.slice(2);
let win,timeout,finished=false;
const report={startedAt:new Date().toISOString(),pageNavigations:0,profileRequests:0,responses:[],errorCode:null};
const requests=new Map(),sections=new Set();
function finish(code=null) {
  if(finished)return;finished=true;clearTimeout(timeout);report.errorCode=code;report.finishedAt=new Date().toISOString();
  fs.writeFileSync(path.join(output,'summary.json'),JSON.stringify(report,null,2),{flag:'wx'});
  if(win&&!win.isDestroyed())win.destroy();app.quit();
}
async function main() {
  if(consent!=='--one-page'||!cookieFile||!output)throw new Error('Explicit paths and --one-page required');
  const url=new URL(pageUrl);
  if(url.origin!=='https://partner.tiktokshop.com'||url.pathname!=='/affiliate-cmp/creator/detail'||!/^\d{1,30}$/.test(url.searchParams.get('cid')))throw new Error('Use an observed Partner Center detail URL');
  if(fs.existsSync(output))throw new Error('Use new output directory');
  const cookies=JSON.parse(fs.readFileSync(cookieFile,'utf8').replace(/^\uFEFF/,''));cookieHeader(cookies,'/');
  fs.mkdirSync(output,{recursive:true});
  app.setPath('userData',path.join(output,'runtime'));await app.whenReady();
  const ses=session.fromPartition('partner-profile-probe-'+Date.now(),{cache:false});
  ses.setPermissionRequestHandler((wc,permission,callback)=>callback(false));
  ses.setPermissionCheckHandler(()=>false);
  for(const c of cookies) {
    const domain=String(c.domain||'').toLowerCase(),host=domain.replace(/^\./,'');
    if(!['tiktokshop.com','partner.tiktokshop.com','api-partner-sg.tiktokshop.com'].includes(host))continue;
    const expires=Number(c.expirationDate??c.expires);
    if(expires>0&&expires*1000<=Date.now())continue;
    const details={url:'https://'+host+(c.path||'/'),name:c.name,value:c.value,path:c.path||'/',secure:c.secure!==false,httpOnly:!!c.httpOnly};
    if(c.hostOnly!==true)details.domain=domain;
    if(expires>0)details.expirationDate=expires;
    const sameSite={no_restriction:'no_restriction',none:'no_restriction',lax:'lax',strict:'strict'}[c.sameSite];if(sameSite)details.sameSite=sameSite;
    await ses.cookies.set(details);
  }
  win=new BrowserWindow({width:1200,height:860,show:false,webPreferences:{session:ses,contextIsolation:true,sandbox:true,nodeIntegration:false}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',(event,next)=>{if(new URL(next).origin!==url.origin)event.preventDefault();});
  const dev=win.webContents.debugger;dev.attach('1.3');await dev.sendCommand('Network.enable');
  dev.on('message',async(event,method,p)=>{
    if(finished)return;
    try {
      if(method==='Network.requestWillBeSent') {
        const requestUrl=new URL(p.request.url);
        if(requestUrl.pathname!=='/api/v1/oec/affiliate/creator/marketplace/4partner/profile'||p.request.method!=='POST')return;
        if(!['https://partner.tiktokshop.com','https://api-partner-sg.tiktokshop.com','https://partner.eu.tiktokshop.com','https://partner.us.tiktokshop.com'].includes(requestUrl.origin))return;
        const body=JSON.parse(p.request.postData||'{}');if(body.creator_oec_id!==url.searchParams.get('cid'))return;
        report.profileRequests++;
        requests.set(p.requestId,{types:body.profile_types||[],origin:requestUrl.origin,queryKeys:[...requestUrl.searchParams.keys()],started:Date.now()});
      } else if(method==='Network.responseReceived'&&requests.has(p.requestId)) {
        const request=requests.get(p.requestId);request.status=p.response.status;
        request.challenge=Object.keys(p.response.headers).some(k=>k.toLowerCase()==='bdturing-verify');
        if(request.challenge){report.responses.push({types:request.types,http:request.status,challenge:true});finish('CHALLENGE');}
      } else if(method==='Network.loadingFinished'&&requests.has(p.requestId)) {
        const request=requests.get(p.requestId);requests.delete(p.requestId);
        const content=await dev.sendCommand('Network.getResponseBody',{requestId:p.requestId});if(finished)return;
        const text=content.base64Encoded?Buffer.from(content.body,'base64').toString('utf8'):content.body;
        if(Buffer.byteLength(text)>1024*1024)throw new ContactError('RESPONSE','Response too large');
        const data=decodeResponse(request.status,{},text),safe=permitted(data);
        fs.writeFileSync(path.join(output,'profile-'+request.types.join('-')+'.json'),JSON.stringify(safe,null,2),{flag:'wx'});
        report.responses.push({types:request.types,http:request.status,code:data.code,durationMs:Date.now()-request.started,origin:request.origin,queryKeys:request.queryKeys});
        request.types.forEach(t=>sections.add(t));if([1,2,3,4,5,6].every(t=>sections.has(t)))finish();
      }
    } catch(error) {finish(error instanceof ContactError?error.code:'CAPTURE');}
  });
  timeout=setTimeout(()=>finish('TIMEOUT'),60000);report.pageNavigations++;
  win.loadURL(url.href).catch(()=>{if(!finished)finish('NAVIGATION');});
}
main().catch(()=>{if(output&&fs.existsSync(output))finish('SETUP');else app.quit();});
