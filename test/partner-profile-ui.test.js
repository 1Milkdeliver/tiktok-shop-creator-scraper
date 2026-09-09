'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),vm=require('vm');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const profile=require('../lib/partner-profile-fields'),contact=require('../lib/contact-fields');

test('full profile fields load before inline code, have labels and appear in drawer/export field catalog',()=>{
  const html=read('index.html'),inline=html.indexOf('// ═══════════ 界面中英切换');
  assert.ok(html.indexOf('src="lib/partner-profile-fields.js"')<inline);
  assert.equal(new Set(profile.FIELDS.map(f=>f.k)).size,profile.FIELDS.length);
  for(const field of profile.FIELDS) { assert.ok(field.n&&field.e&&profile.LABELS[field.k]); assert.ok(!contact.FIELDS.some(f=>f.k===field.k)); }
  const start=html.indexOf('const FIELDS = ['),end=html.indexOf('const UPDATE_FIELD_GROUPS',start);
  const context={window:{CreatorContactFields:contact,PartnerProfileFields:profile}};vm.createContext(context);
  vm.runInContext(html.slice(start,end)+';this.fieldKeys=FIELDS.map(f=>f.k)',context);
  for(const field of profile.FIELDS)assert.ok(context.fieldKeys.includes(field.k));
  assert.match(html,/fields: window\.PartnerProfileFields\.FIELDS\.map\(f => f\.k\)/);
  assert.match(html,/!field\.contact && !field\.partner/);
  for(const m of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);
});

test('IPC scopes full mode separately and keeps contact-only as default; offline suite excludes live scripts',()=>{
  const main=read('main.js'),ui=read('lib/contact-ui.js');
  assert.equal((main.match(/\.\/lib\/partner-profile-fields'\)\.LABELS/g)||[]).length,2);
  assert.match(main,/mode = payload\.mode === 'full' \? 'full' : 'contacts'/);
  assert.match(main,/resume:payload\.onlyUnchecked !== false/);
  assert.match(main,/query = mode === 'full' \? 'partnerProfileTargets' : 'contactTargets'/);
  assert.match(ui,/mode:el\('contactMode'\)\.value/);
  assert.match(ui,/status\.sectionsSaved/);
  assert.match(ui,/尚未通过真实详情验证/);
  assert.equal(JSON.parse(read('package.json')).scripts.test,'node --test test/*.test.js');
});
