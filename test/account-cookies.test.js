'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const api=require('../lib/account-cookies');
const data=JSON.stringify([{name:'sessionid',value:'synthetic-only',expirationDate:5000},{name:'tracking',value:'fixture',expirationDate:1}]);
test('country labels prioritize accounts but never restrict target market access',()=>{
  const accounts=api.normalize([{data,name:'马来账号',region:'MY'},{data,name:'泰国账号',region:'TH'}]);
  assert.equal(api.select(accounts,'my')[0].name,'马来账号');
  assert.equal(api.select(accounts,'TH').length,1);
  assert.equal(api.select(accounts,'US').length,1); // same session, two labels
  assert.equal(api.select(accounts,'TH')[0].name,'泰国账号');
  assert.throws(()=>api.select(accounts,''),/目标国家/);
  assert.throws(()=>api.select([],'US'),/导入采集 Cookie/);
  assert.equal(api.normalize([data])[0].region,''); // legacy country stays unknown
  assert.equal(api.region('uk'),'GB');
});
test('other-market and legacy accounts participate; duplicate auth ignores JSON formatting and tracking',()=>{
  const second=JSON.stringify([{name:'sessionid',value:'different-synthetic'}]);
  const duplicate=JSON.stringify([{name:'tracking',value:'changed'},{name:'sessionid',value:'synthetic-only'}],null,2);
  const entries=[{data,region:'MY',name:'first'}, {data:second,region:'TH',name:'second'},duplicate];
  assert.deepEqual(api.select(entries,'US').map(c=>c.name),['first','second']);
  assert.equal(api.select([second],'US').length,1);
  assert.equal(entries.length,3); // selection never deletes saved entries
});
test('expiry summary ignores tracking cookies and does not invent identity or country',()=>{
  assert.deepEqual(api.summary(data,10000),{count:2,expiresAt:5000000,expired:false});
  assert.equal(api.summary(JSON.stringify([{name:'tracking',value:'x',expires:1}])).expiresAt,null);
});
