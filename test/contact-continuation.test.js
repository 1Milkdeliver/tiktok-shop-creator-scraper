'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { CreatorDatabase } = require('../lib/database');
const { ContactJob } = require('../lib/partner-contacts');
const { parseContacts } = require('../lib/contact-fields');

test('all 1005 scoped creators persist once across Stop and database reopen, independent of table pages', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'contact-continuation-'));
  const db = new CreatorDatabase(path.join(dir,'synthetic.db'));
  t.after(()=>db.close());
  await db.open();
  const ids = Array.from({length:1005},(_,i)=>String(7494000000000000000n + BigInt(i)));
  await db.upsertCreators(ids.map(id=>({creator_oecuid:id,handle:'fixture-'+id,category:'Electronics',
    follower_cnt:2000,'合作邮箱':'before@example.test'})),{region:'MY'});
  await db.upsertCreators([{creator_oecuid:'998',handle:'other-category',category:'Beauty','合作邮箱':'before@example.test'}],{region:'MY'});
  await db.upsertCreators([{creator_oecuid:ids[0],handle:'other-region',category:'Electronics','合作邮箱':'before@example.test'}],{region:'TH'});
  const filters = {region:'MY',category:'Electronics',search:'before@example.test',limit:1,offset:800};
  assert.equal((await db.listCreators(filters)).rows.length,1);
  const targets = await db.contactTargets(filters,'MY');
  assert.equal(targets.length,1005);
  const calls = [], writes = [], update = db.updateCreatorContacts.bind(db);
  const client = {resolvePartner:async()=>{},fetchContacts:async(region,id)=>{
    assert.equal(region,'MY'); calls.push(id);
    // Empty responses are real checked results; nonempty responses change the
    // search filter, so paging a live unchecked query would skip pending rows.
    return parseContacts(calls.length % 7 === 0 ? [] : [
      {field:1,value:'001234'},{field:31,value:'fixture-line'},{field:2,value:'after@example.test'}
    ]);
  }};
  const first = new ContactJob({intervalMs:0});
  db.updateCreatorContacts = async(region,id,patch)=>{
    const saved = await update(region,id,patch); writes.push(id);
    if (writes.length === 503) first.stop();
    return saved;
  };
  first.start({region:'MY',targets,client,db}); await first.done;
  assert.equal(first.state.completed,503); assert.equal(first.state.outcome,'stopped');
  assert.deepEqual(calls,ids.slice(0,503)); assert.deepEqual(writes,calls);
  await db.close(); await db.open(); // Real on-disk resume, no production data.
  const remaining = await db.contactTargets(filters,'MY');
  assert.deepEqual(remaining,ids.slice(503));
  const next = new ContactJob({intervalMs:0});
  next.start({region:'MY',targets:remaining,client,db}); await next.done;
  assert.equal(next.state.total,502); assert.equal(next.state.completed,502);
  assert.equal(next.state.outcome,'completed');
  assert.deepEqual(calls,ids); assert.deepEqual(writes,ids);
  assert.equal(new Set(calls).size,1005);
  assert.deepEqual(await db.contactTargets(filters,'MY'),[]);
  assert.deepEqual(await db.contactTargets({category:'Electronics'},'MY'),[]);
  assert.equal((await db.contactTargets({category:'Electronics'},'MY',false)).length,1005);
  assert.equal((await db.listCreators({})).total,1007);
  const checked = await db.get("SELECT COUNT(*) AS n FROM creators WHERE region='MY' AND json_extract(raw_json,'$.contact_checked_at') IS NOT NULL");
  assert.equal(checked.n,1005);
  const sample = (await db.listCreators({region:'MY',search:ids[0]})).rows[0];
  assert.equal(sample.follower_count,2000); assert.equal(sample.whatsapp,'001234'); assert.equal(sample.line,'fixture-line');
  assert.equal((await db.listCreators({region:'TH'})).rows[0].contact_email,'before@example.test');
  assert.equal(first.state.found + next.state.found,1005 - Math.floor(1005/7));
  assert.equal(first.state.empty + next.state.empty,Math.floor(1005/7));
});
