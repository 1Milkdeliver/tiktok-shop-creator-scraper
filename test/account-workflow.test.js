'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const AccountCookies=require('../lib/account-cookies');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
test('continue uses manually selected country, retains the whole account pool and dedupes this country', async()=>{
  const handlers={},els=new Map(),calls=[];
  const el=id=>{if(!els.has(id))els.set(id,{value:'',checked:true,focus(){},classList:{}});return els.get(id);};
  const data=JSON.stringify([{name:'sessionid',value:'synthetic',domain:'.example.test'}]);
  const cookies=[{data,region:'MY',name:'fixture MY'},{data,region:'TH',name:'fixture TH'}];
  const context={uiLang:'zh',document:{getElementById:el},cookieList:cookies,FIELDS:[],
    taskAccounts:region=>AccountCookies.select(cookies,region),confirm:()=>true,alert:msg=>calls.push(['alert',msg]),
    syncTaskPageFromConfig(){},showPage(){},setStatus(){},setStopButtonActive(){},lockOptions(){},
    window:{api:{getLastScrapeConfig:async()=>({shopRegion:'US',keywords:['fixture'],detail:true,enrichContacts:true}),
      listCreatorIds:async query=>{calls.push(['ids',query]);return {ids:['123']};},
      start:async cfg=>{calls.push(['start',cfg]);return {ok:true};}}}};
  vm.createContext(context);
  const source=html.slice(html.indexOf("document.getElementById('creatorContinueOpen').onclick"),html.indexOf("document.getElementById('libraryUpdateClose').onclick"));
  vm.runInContext(source,context);
  await el('creatorContinueOpen').onclick(); assert.equal(calls[0][0],'alert');
  el('creatorContinueRegion').value='MY'; calls.length=0;
  await el('creatorContinueOpen').onclick();
  assert.equal(calls[0][1].region,'MY');assert.equal(calls[1][1].shopRegion,'MY');
  assert.equal(calls[1][1].accountEntries.length,2);assert.equal(calls[1][1].dedupe,true);
  assert.equal(calls[1][1].enrichContacts,true);assert.equal(cookies.length,2);
});
test('account IPC persists notes without removing other countries or unrelated app settings',()=>{
  const source=fs.readFileSync(path.join(root,'main.js'),'utf8');
  const handlers={},writes=[];
  const context={AccountCookies,OUT_DIR:'fixture',runner:{running:false},appData:{cookies:[],history:[{fixture:true}],otherSetting:42},
    fs:{writeFileSync:(_file,text)=>writes.push(JSON.parse(text))},dataFile:()=>'/synthetic/app-data.json',saveAppData(){},
    ipcMain:{handle:(name,fn)=>handlers[name]=fn}};
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('// IPC: remembered cookies'),source.indexOf("ipcMain.handle('creator-db-stats'")),context);
  const data=JSON.stringify([{name:'sessionid',value:'synthetic'}]);
  assert.equal(handlers['save-accounts'](null,[{data,name:'MY note',region:'MY'},{data,name:'TH note',region:'TH'}]).ok,true);
  const saved=handlers['get-app-data'](); assert.equal(saved.accountEntries[1].region,'TH');assert.equal(saved.accountEntries[0].name,'MY note');
  assert.equal(writes[0].otherSetting,42);assert.equal(writes[0].history.length,1);
  context.runner.running=true;assert.equal(handlers['save-accounts'](null,[]).ok,false);assert.equal(writes.length,1);
});
test('failure handling does not delete saved Cookie accounts or export credentials',()=>{
  const source=fs.readFileSync(path.join(root,'main.js'),'utf8');
  const onDone=source.slice(source.indexOf('runner.onDone'),source.indexOf('// ---- app folders:'));
  assert.doesNotMatch(onDone,/appData\.cookies\.splice/);
  const poll=html.slice(html.indexOf('async function poll()'),html.indexOf('function showResult('));
  assert.doesNotMatch(poll,/cookieList\.splice/);
  assert.match(poll,/j\.result\.error/);
});

test('Partner contacts check task market access, not imported country labels',async()=>{
  const source=fs.readFileSync(path.join(root,'main.js'),'utf8');
  const handlers={},calls=[];
  const context={ipcMain:{handle:(name,fn)=>handlers[name]=fn},contactsBusy:()=>false,runner:{running:false},
    creatorDb:{contactTargets:async(_filters,region)=>{calls.push(region);return ['123'];}},
    partnerContactClient:{},partnerAccount:{region:'MY',name:'fixture'},contactPreparing:false,contactPreparationVersion:0,
    MARKETS:{US:100,MY:6},contactDatabase:db=>db,writeDatabase(){},
    contactJob:{start:cfg=>calls.push(cfg.region)},collectionContacts:null,automaticContacts:{}};
  vm.createContext(context);
  const begin=source.indexOf("ipcMain.handle('partner-contacts-start'");
  const end=source.indexOf('\nipcMain.handle(',begin+1);
  vm.runInContext(source.slice(begin,end),context);
  assert.equal((await handlers['partner-contacts-start'](null,{region:'US',expectedTotal:1})).ok,true);
  assert.deepEqual(calls,['US','US']);
  const onStart=source.slice(source.indexOf('runner.onStart'),source.indexOf('runner.onDone'));
  assert.match(onStart,/client:runner.activePartnerClient \|\| partnerContactClient/);
  assert.doesNotMatch(onStart,/partnerAccount\.region/);
});

test('installer preserves in-flight writes by refusing to force-terminate the application',()=>{
  const script=fs.readFileSync(path.join(root,'build/nsis-auto-close.nsh'),'utf8');
  assert.doesNotMatch(script,/taskkill|_KillProcess|TerminateProcess/i);
  assert.match(script,/SetErrorLevel 2/);assert.match(script,/Abort/);
  assert.match(script,/IfSilent creatorRequireExit/);
});
