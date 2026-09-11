'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Accounts = require('./account-cookies');
const {PartnerContactClient,ContactError} = require('./partner-contacts');
const {SECTIONS,parseSection} = require('./partner-profile');

function selectClients(config, memoryClient) {
  if (config.discoverySource === 'seller') return null;
  const entries = (config.cookieFiles || []).map(file => fs.readFileSync(file,'utf8'));
  const selected = entries.filter(raw => config.discoverySource === 'partner' ||
    (config.discoverySource !== 'seller' && Accounts.source(raw) === 'partner'));
  if (selected.length) return selected.map(raw => {
    try { return new PartnerContactClient(Accounts.parse(raw)); }
    catch (error) { return {resolvePartner:async()=>{throw error;}}; }
  });
  if (memoryClient && (config.discoverySource === 'partner' || !entries.length)) return [memoryClient];
  if (config.discoverySource === 'partner') throw new Error('请先导入团长 Cookie。');
  return null;
}
function listRow(profile,region) {
  const id = profile?.creator_oecuid?.value ?? profile?.creator_oecuid;
  if (typeof id !== 'string' || !/^\d{1,30}$/.test(id)) throw new ContactError('PROFILE_ID','团长列表缺少有效达人 ID，未写入。');
  const parsed=parseSection({creator_profile:profile},SECTIONS[0],id,region);
  // Preserve every authorized field already returned, including fields not yet
  // mapped to a table column. Do not fetch the same data again just to retain it.
  return {...parsed.patch,partner_discovery_json:JSON.stringify(parsed.details.profile)};
}

// Read-only Partner discovery. No seller landing, invitations, IM pages, or credential rewriting.
// Checkpoints move only AFTER all page rows and requested modules have been committed.
async function runPartnerDiscovery(runner,config,clients) {
  const region = config.shopRegion, seen = new Set(), existing = new Set(config.existingIds || []);
  const testStopAfter = Number.isInteger(config.testStopAfter) && config.testStopAfter > 0 ? config.testStopAfter : Infinity;
  const controller = runner.partnerController = new AbortController();
  const signal = controller.signal;
  runner.verificationGate=new (require('./verification-gate').VerificationGate)();
  const sessions = runner.sessions = clients.map((client,index) => ({client,index,creators:[],details:[],startupState:'pending'}));
  let active, browserSession, lastRequest = 0, saved = 0, inserted = 0, profileCount = 0, testStopReached = false;
  const queries = config.creatorInput?.length ? [] : (config.keywords?.length ? config.keywords : ['']);
  const ids = config.creatorInput?.length ? config.creatorInput.map(String) : null;
  const scope = {region,queries,ids,detail:!!config.detail,refresh:!!config.libraryUpdate};
  const directory = /\.(csv|xlsx)$/i.test(config.outPath || '') ? path.dirname(config.outPath) : config.outPath;
  const file = directory && path.join(directory,'.resume-partner-' + crypto.createHash('sha256').update(JSON.stringify(scope)).digest('hex').slice(0,20) + '.json');
  let checkpoint = {version:1,queryIndex:0,pagination:{size:12,page:0}};
  let transientAttempts=0, limitAttempts=0;
  const store = () => {
    if (!file || config.testMode) return;
    fs.mkdirSync(directory,{recursive:true});
    fs.writeFileSync(file + '.tmp',JSON.stringify(checkpoint)); fs.renameSync(file + '.tmp',file);
  };
  const pace = async () => {
    await runner.pauseGate();
    const remaining = lastRequest + (config.partnerIntervalMs ?? 10000) - Date.now();
    if (remaining > 0) await runner.interruptibleSleep(remaining);
    await runner.pauseGate();
    if (runner.stopped || signal.aborted) throw new ContactError('STOPPED','已停止，已入库资料与断点保留。');
    lastRequest = Date.now();
  };
  const read = async operation => {
    for (;;) {
      await runner.pauseGate();
      if (runner.stopped || signal.aborted) throw new ContactError('STOPPED','已停止，已入库资料与断点保留。');
      try {
        const value=await operation(); transientAttempts=0; limitAttempts=0; runner.rateLimit=null; return value;
      } catch(error) {
        const transport=error instanceof ContactError && (['NETWORK','TIMEOUT'].includes(error.code)
          || (error.code==='HTTP' && [500,502,503,504].includes(error.status)));
        const limited=error instanceof ContactError && error.code==='RATE_LIMIT';
        if (!transport && !limited) throw error;
        const schedule=limited ? (config.partnerRateLimitDelaysMs || [1800000,3600000])
          : (config.partnerRetryDelaysMs || [30000,60000,120000,300000]);
        const index=limited?limitAttempts++:transientAttempts++;
        const suggested=limited && Number.isFinite(error.retryAfterMs) ? error.retryAfterMs : 0;
        const wait=Math.max(suggested,schedule[Math.min(index,schedule.length-1)]);
        runner.rateLimit=limited?{at:Date.now(),reason:'Partner API 429',retryAt:Date.now()+wait}:null;
        runner.log((limited?'平台限流':'网络暂时异常')+'：保留当前页断点，'+Math.ceil(wait/60000)+' 分钟后自动重试；可随时结束任务。');
        await new Promise((resolve,reject)=>{
          const timer=setTimeout(resolve,wait);
          signal.addEventListener('abort',()=>{clearTimeout(timer);reject(new ContactError('STOPPED','已停止，已入库资料与断点保留。'));},{once:true});
        });
      }
    }
  };
  const persist = async row => {
    if (config.testMode) return;
    const result = await runner.persistRows([row],config);
    if (result?.saved !== 1) throw new ContactError('SAVE','达人未成功写入数据库，已停止。');
    inserted += result.inserted || 0;
  };
  const processProfile = async profile => {
    if (saved >= testStopAfter) { testStopReached = true; return; }
    const row = listRow(profile,region), id = row.creator_oecuid;
    if (seen.has(id)) return;
    const old = await runner.onPartnerRaw?.(region,id);
    if (config.dedupe && existing.has(id) && (!config.detail || old?.partner_profile_completed_at)) { seen.add(id); return; }
    await persist(row); // A creator without contacts is still saved, before detail/contact requests.
    active.creators.push(row); saved++;
    if (config.detail && !config.testMode) {
      if (!runner.onPartnerProfile) throw new ContactError('SAVE','资料模块保存接口未就绪。');
      const parse = text => text ? JSON.parse(text) : {};
      const previous = config.libraryUpdate ? {} : parse(old?.partner_checkpoint_json);
      const progress = previous.version === 1 ? previous : {version:1,sections:{}};
      if (!progress.sections || typeof progress.sections !== 'object') throw new ContactError('CHECKPOINT','资料断点格式异常，已保留数据。');
      const details = parse(old?.partner_details_json); details.version=1; details.sections ||= {};
      const statuses = parse(old?.partner_field_status);
      let profilePageOpened=false;
      for (const section of SECTIONS) {
        if (progress.sections[section.key]) continue;
        if (!active.client.profilePageDriven || !profilePageOpened) await pace();
        profilePageOpened=true;
        const result = parseSection(await read(()=>active.client.fetchProfileSection(region,id,section.types,signal)),section,id,region);
        const at = new Date().toISOString();
        progress.sections[section.key]=at; statuses[section.key]=result.status;
        details.sections[section.key]={checkedAt:at,...result.details};
        const commit = await runner.onPartnerProfile(region,id,{...result.patch,
          partner_checkpoint_json:JSON.stringify(progress),partner_field_status:JSON.stringify(statuses),
          partner_details_json:JSON.stringify(details),partner_profile_checked_at:at,
          partner_profile_status:'资料模块已检查：'+section.name,partner_profile_completed_at:null});
        if (commit?.saved !== 1) throw new ContactError('SAVE','资料模块未成功入库。');
      }
      const commit = await runner.onPartnerProfile(region,id,{partner_profile_completed_at:new Date().toISOString(),
        partner_profile_status:'资料模块已检查；联系方式见独立状态'});
      if (commit?.saved !== 1) throw new ContactError('SAVE','资料完成状态未成功入库。');
      profileCount++;
      runner.log(`  会话#${active.index + 1} 详情 ${profileCount} 条（${region} · 已入库）`);
    }
    seen.add(id); runner.currentInfo.completed=saved;
    if (saved >= testStopAfter) testStopReached = true;
  };
  try {
    if (ids?.some(id=>!/^\d{1,30}$/.test(id))) throw new ContactError('CREATOR_ID','团长名单模式请填写达人数字 ID，暂不支持账号名；可改用关键词搜索。');
    runner.log('已加载团长 Cookie：使用 Partner Center 采集入口；目标 '+region+'，导入国家备注不限制市场。');
    for (const session of sessions) {
      try {
        await pace(); await read(()=>session.client.resolvePartner(region,signal));
        active=session; session.startupState='ready'; break;
      } catch (error) {
        session.startupState=error.code || 'error';
        if (!['AUTH','COOKIE_MISSING','MARKET_AUTH'].includes(error.code)) throw error;
        runner.log('团长账号 #'+(session.index+1)+' 未通过目标地区授权检查，保留账号并检查下一账号。');
      }
    }
    if (!active) throw new ContactError('AUTH','没有账号通过目标地区授权检查；Cookie 已加载，请检查登录状态和市场权限。');
    if (config.partnerBrowserSession === true || config.partnerBrowserFactory) {
      const open=config.partnerBrowserFactory || require('./partner-browser').openPartnerBrowserSession;
      runner.log('正在建立目标地区 Partner Center 后台会话；列表与资料使用页面会话，联系方式沿用独立接口读取。');
      browserSession=await open(active.client.cookies,region,{signal,isStopped:()=>runner.stopped,onLog:message=>runner.log(message),
        onVerificationRequired:context=>runner.verificationGate.wait({...context,signal:context.signal||signal})});
      const previousTransport=active.client.transport;
      let directClient;
      active.client.transport=async(url,headers,requestSignal,options)=>{
        if(url.pathname.endsWith('/4partner/find')||url.pathname.endsWith('/4partner/profile'))
          return browserSession.request(url,headers,requestSignal,options);
        if(previousTransport)return previousTransport(url,headers,requestSignal,options);
        for(;;){
          directClient ||= new PartnerContactClient(active.client.cookies);
          try{return await directClient.request(url.href,{},requestSignal,options.body===undefined?undefined:JSON.parse(options.body));}
          catch(error){
            if(error.code!=='CHALLENGE'||!browserSession.requestManualVerification)throw error;
            await browserSession.requestManualVerification(requestSignal);
            // Use the verified browser session in memory, without exposing or
            // writing refreshed credentials to logs, exports or test reports.
            directClient=new PartnerContactClient(await browserSession.refreshedCookies());
          }
        }
      };
      active.client.profilePageDriven=browserSession.profilePageDriven===true;
      active.client.closeBrowserSession=browserSession.close;
      runner.partnerBrowserSession=browserSession;
    }
    runner.activePartnerClient=active.client;
    runner.log('目标地区授权检查通过；正在读取达人列表（此后仍可能需要平台验证）。');
    runner.onStart?.(config);
    if (!config.testMode && file && fs.existsSync(file)) {
      const stored=JSON.parse(fs.readFileSync(file,'utf8'));
      if (stored.version!==1 || !Number.isInteger(stored.queryIndex) || stored.queryIndex<0 || !stored.pagination) throw new ContactError('CHECKPOINT','团长列表断点无效，未覆盖原文件。');
      checkpoint=stored;
    }
    if (ids) {
      while (checkpoint.queryIndex<ids.length && !testStopReached) {
        await pace();
        const response=await read(()=>active.client.fetchProfileSection(region,ids[checkpoint.queryIndex],[1,6],signal));
        await processProfile(response?.data?.creator_profile ?? response.creator_profile);
        checkpoint.queryIndex++; store();
        if (config.testMode) break;
      }
    } else for (;checkpoint.queryIndex<queries.length && !testStopReached;) {
      const query=queries[checkpoint.queryIndex];
      const cursors=new Set();
      for (;;) {
        const cursor=JSON.stringify(checkpoint.pagination);
        if (cursors.has(cursor)) throw new ContactError('PAGINATION','平台分页未前进，已保留断点，未假报完成。');
        cursors.add(cursor);
        await pace(); runner.currentInfo.keyword=query; runner.currentInfo.page=checkpoint.pagination.page;
        const result=await read(()=>active.client.findCreators(region,query,checkpoint.pagination,signal));
        runner.log(`  会话#${active.index + 1} ${region} · 关键词「${query || '全部'}」· 第 ${checkpoint.pagination.page + 1} 页：返回 ${result.profiles.length} 位`);
        for (const profile of result.profiles) {
          await processProfile(profile);
          if (testStopReached) break;
        }
        runner.log(`  会话#${active.index + 1} 累计入库 ${saved} 位（新增 ${inserted} · 更新 ${Math.max(0,saved-inserted)}）；联系方式独立并行处理`);
        if (testStopReached) {
          runner.log('实测样本已达到 '+saved+' 位；结束发现并等待并行联系方式队列排空。');
          store();
          break;
        }
        if (config.testMode) break;
        if (!result.pagination.has_more) { checkpoint={version:1,queryIndex:checkpoint.queryIndex+1,pagination:{size:12,page:0}}; store(); break; }
        if (!result.profiles.length) throw new ContactError('PAGINATION','平台返回空页但标记仍有下一页，已保留断点。');
        checkpoint.pagination={size:12,page:result.pagination.next_page,search_key:result.pagination.search_key,next_item_cursor:result.pagination.next_item_cursor};
        if (!Number.isInteger(checkpoint.pagination.page) || checkpoint.pagination.page<0) throw new ContactError('PAGINATION','平台未返回有效下一页，已保留断点。');
        store();
      }
      if (config.testMode) break;
    }
    if (runner.stopped) throw new ContactError('STOPPED','已停止，断点保留。');
    if (file && !config.testMode && fs.existsSync(file) && !testStopReached) fs.unlinkSync(file);
    runner.result={ok:true,rows:saved,creators:saved,details:profileCount,sessions:clients.length,testMode:!!config.testMode,
      libraryOnly:true,libraryUpdate:!!config.libraryUpdate,testStopReached,database:{saved:config.testMode?0:saved,inserted,updated:Math.max(0,saved-inserted)},outPath:''};
    runner.log('团长资料采集完成；数据保存在达人库，可按需导出。联系方式队列继续处理剩余项。');
  } catch (error) {
    runner.collectionIncomplete=true; runner.storageError=error.code==='SAVE'; runner.status='error';
    const message=error instanceof ContactError ? error.message : '团长采集内部异常，已保留数据与断点。';
    runner.log(message);
    runner.result={ok:false,error:message,errorCode:error.code || 'INTERNAL',rows:saved,creators:saved,
      database:{saved:config.testMode?0:saved,inserted},testMode:!!config.testMode};
  } finally {
    runner.running=false; if (runner.status!=='error') runner.status='done';
    for (const session of sessions) session.done=true;
    runner.result.doneAt=Date.now(); runner.result.accountStates=sessions.map(s=>({index:s.index,state:s.startupState}));
    runner.onDone?.(runner.result);
    if (!config.enrichContacts) await browserSession?.close?.();
    runner.activePartnerClient=null; runner.partnerController=null;
  }
}
module.exports={selectClients,listRow,runPartnerDiscovery};
