'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');

test('actual contact UI shows unbounded scope, durable pause counts and recovery countdown in both languages', async () => {
  const elements = new Map(), listeners = {}, confirmations = [];
  const el = id => {
    if (!elements.has(id)) elements.set(id,{value:'',checked:false,textContent:'',disabled:false,
      scrollTop:0,scrollHeight:0,clientHeight:0,classList:{contains:()=>false}});
    return elements.get(id);
  };
  el('contactRegion').value = 'MY'; el('contactMode').value = 'contacts'; el('contactUnchecked').checked = true;
  let status = {running:false,outcome:'paused',connected:true,completed:503,total:1005,found:430,empty:73,logs:[],region:'MY',mode:'contacts'};
  const context = {I18N:{},uiLang:'zh',activePage:'creators',setInterval(){},
    document:{getElementById:el,addEventListener:(name,fn)=>{listeners[name]=fn;}},
    buildFieldFilters:()=>({}),loadCreators:async()=>{},refreshDatabaseMetrics:async()=>{},
    confirm:text=>{confirmations.push(text);return false;},
    window:{api:{partnerContactsStatus:async()=>status,partnerContactsPreview:async payload=>{
      assert.equal(payload.region,'MY'); assert.equal(payload.onlyUnchecked,true);
      return {ok:true,total:502};
    }}}
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../lib/contact-ui.js'),'utf8'),context);
  await listeners.DOMContentLoaded();
  assert.match(el('contactProgress').textContent,/已暂停，进度已保留.*待完成 502/);
  await el('contactStart').onclick();
  assert.match(el('contactScope').textContent,/不设固定条数上限/);
  assert.match(confirmations[0],/全部 502 位 MY.*不设固定条数上限/);
  assert.doesNotMatch(confirmations[0],/平台有访问额度限制/);
  context.uiLang = 'en';
  await el('contactStart').onclick();
  assert.match(el('contactScope').textContent,/No fixed creator limit/);
  assert.match(confirmations[1],/all 502.*without a fixed creator limit/);
  status = {...status,running:true,outcome:'running',retryAt:new Date(Date.now()+60000).toISOString()};
  await listeners.DOMContentLoaded();
  assert.match(el('contactProgress').textContent,/Remaining 502.*Recovering: retry in \d+s/);
  assert.equal(el('contactStart').disabled,true); assert.equal(el('contactStop').disabled,false);
  status = {...status,running:false,outcome:'completed',completed:1005,retryAt:null};
  await listeners.DOMContentLoaded();
  assert.match(el('contactProgress').textContent,/Scope complete.*Remaining 0/);
  assert.doesNotMatch(el('contactProgress').textContent,/Recovering/);
  assert.ok(context.I18N['contacts.recovery'].zh && context.I18N['contacts.recovery'].en);
  status = {...status,automatic:{outcome:'needs_auth'}};
  await listeners.DOMContentLoaded();
  assert.match(el('taskContactProgress').textContent,/Creators saved; Partner authorization is missing/);
  status = {...status,running:true,outcome:'running',automatic:{outcome:'started'}};
  await listeners.DOMContentLoaded();
  assert.match(el('taskContactProgress').textContent,/Saved 1005.*Running/);
  assert.equal(el('taskContactStop').disabled,false);
  context.uiLang='zh';
  status={...status,running:false,preparing:true,automatic:{outcome:'preparing'}};
  await listeners.DOMContentLoaded();
  assert.match(el('taskContactProgress').textContent,/正在准备本轮/);
  assert.equal(el('taskContactStop').disabled,false);assert.equal(el('contactStart').disabled,true);
});
