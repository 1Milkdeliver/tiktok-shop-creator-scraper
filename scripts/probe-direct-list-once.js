'use strict';
// Exactly one direct list call after the selected market authorization check.
// Reuses the user's current browser session in memory; does not open/scroll pages.
const puppeteer=require('puppeteer-core');
const {PartnerContactClient}=require('../lib/partner-contacts');
const {CreatorDatabase}=require('../lib/database');
const {listRow}=require('../lib/partner-discovery');
const {permitted}=require('../lib/partner-profile');
async function main(){
  const [appPort,browserPort,dbPath]=process.argv.slice(2);
  if(!/^\d+$/.test(appPort||'')||!/^\d+$/.test(browserPort||'')||!dbPath)throw new Error('Setup');
  const report={mode:'node-https-direct',region:'MY',requested:12,authorizationChecked:false,listRequests:0,returned:0,saved:0,newCreators:0,openedPages:0};
  let app,browser,db;
  try{
    app=await puppeteer.connect({browserURL:'http://127.0.0.1:'+appPort});
    const page=(await app.pages()).find(p=>p.url().startsWith('file:'));
    const state=await page.evaluate(async()=>{const s=await api.status(),c=await api.partnerContactsStatus();return {running:s.running,contactsRunning:c.running};});
    if(state.running||state.contactsRunning)throw Object.assign(new Error('Busy'),{code:'BUSY'});
    browser=await puppeteer.connect({browserURL:'http://127.0.0.1:'+browserPort});
    const hasMarket=(await browser.pages()).some(p=>{try{const u=new URL(p.url());return u.origin==='https://partner.tiktokshop.com'&&u.searchParams.get('market')==='6';}catch{return false;}});
    if(!hasMarket)throw Object.assign(new Error('Context'),{code:'MARKET_AUTH'});
    const client=new PartnerContactClient(await browser.defaultBrowserContext().cookies());
    db=new CreatorDatabase(dbPath);await db.open();
    const job=await db.get('SELECT id,region FROM scrape_jobs ORDER BY started_at DESC LIMIT 1');
    if(job?.region!=='MY')throw Object.assign(new Error('Region'),{code:'MARKET_AUTH'});
    await client.resolvePartner('MY');report.authorizationChecked=true;
    report.listRequests=1;const started=Date.now();
    let result;
    try{result=await client.findCreators('MY','',{size:12,page:0});}
    finally{report.elapsedMs=Date.now()-started;}
    report.returned=result.profiles.length;report.hasMore=result.pagination.has_more;
    for(const raw of result.profiles){
      const row=listRow(raw,'MY');
      const old=await db.partnerProfileRaw('MY',row.creator_oecuid);
      const saved=old?await db.updatePartnerProfile('MY',row.creator_oecuid,{partner_direct_list_probe_json:JSON.stringify(permitted(raw))}):await db.upsertCreators([row],{region:'MY',jobId:job.id,preserveContacts:true});
      if(saved?.saved!==1)throw Object.assign(new Error('Save'),{code:'SAVE'});
      report.saved++;if(!old)report.newCreators++;
    }
  }catch(error){report.errorCode=['BUSY','MARKET_AUTH','COOKIE_MISSING','CHALLENGE','RATE_LIMIT','AUTH','QUOTA','NETWORK','TIMEOUT','HTTP','API','RESPONSE','SAVE'].includes(error.code)?error.code:'SETUP_FAILED';}
  finally{if(db)await db.close();if(browser)await browser.disconnect();if(app)await app.disconnect();console.log(JSON.stringify(report));}
}
main().catch(()=>{console.error('DIRECT_PROBE_SETUP_FAILED');process.exitCode=1;});
