'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('fs'),os=require('os'),path=require('path'),sqlite=require('sqlite3');
const {audit}=require('../scripts/audit-active-partner-job');
test('active audit is read-only, counts zero and false, and distinguishes retained contacts from current checks',async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'partner-audit-test-')),file=path.join(directory,'fixture.db');
  const db=await new Promise((resolve,reject)=>{const c=new sqlite.Database(file,error=>error?reject(error):resolve(c));});
  const run=(sql,args=[])=>new Promise((resolve,reject)=>db.run(sql,args,error=>error?reject(error):resolve()));
  try{
    await run('CREATE TABLE scrape_jobs(id TEXT,region TEXT,status TEXT,started_at TEXT)');
    await run('CREATE TABLE creators(id INTEGER,region TEXT,raw_json TEXT)');
    await run('CREATE TABLE scrape_job_creators(job_id TEXT,creator_row_id INTEGER)');
    await run('INSERT INTO scrape_jobs VALUES(?,?,?,?)',['test','MY','running','2026-09-10T00:00:00Z']);
    await run('INSERT INTO creators VALUES(?,?,?)',[1,'MY',JSON.stringify({handle:'synthetic-private-value',follower_cnt:0,is_fast_growing:false,
      contact_checked_at:'2026-09-09T00:00:00Z',contact_status:'已获取','合作邮箱':'synthetic@example.invalid',
      partner_profile_completed_at:'2026-09-10T01:00:00Z',partner_checkpoint_json:JSON.stringify({sections:{basic:true}})})]);
    await run('INSERT INTO scrape_job_creators VALUES(?,?)',['test',1]);
  }finally{await new Promise(resolve=>db.close(resolve));}
  try{
    const before=fs.readFileSync(file),report=await audit(file);
    assert.deepEqual(fs.readFileSync(file),before);
    assert.equal(report.rows,1);assert.equal(report.fieldCounts.follower_cnt.present,1);assert.equal(report.fieldCounts.is_fast_growing.present,1);
    assert.equal(report.fieldCounts['合作邮箱'].present,1);assert.equal(report.contactsChecked,1);assert.equal(report.contactsCheckedThisRun,0);
    assert.equal(report.profilesCompletedThisRun,1);assert.equal(report.sectionCounts.basic,1);assert.equal(report.sectionsCheckedThisRun.basic,0);assert.equal(report.databaseIntegrity,'ok');
    assert.ok(!JSON.stringify(report).includes('synthetic-private-value'));assert.ok(!JSON.stringify(report).includes('synthetic@example.invalid'));
  }finally{
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep));
    assert.ok(path.basename(directory).startsWith('partner-audit-test-'));
    fs.rmSync(directory,{recursive:true,force:true});
  }
});
