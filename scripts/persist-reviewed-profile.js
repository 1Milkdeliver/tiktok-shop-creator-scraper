'use strict';
// One reviewed page, no network / Cookie reads. Backup first, never insert/delete.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('node:assert/strict'),sqlite3=require('sqlite3');
const {CreatorDatabase}=require('../lib/database');
const {buildPageObservationPatch}=require('../lib/partner-page-observation');
const {KEYS:CONTACT_KEYS}=require('../lib/contact-fields');
const {exportCsv,exportXlsx}=require('../lib/exporter');
async function existingDatabase(file){const db=new CreatorDatabase(file);db.db=await new Promise((resolve,reject)=>{const conn=new sqlite3.Database(file,sqlite3.OPEN_READWRITE,error=>error?reject(error):resolve(conn));});await db.exec('PRAGMA busy_timeout=5000;');return db;}
async function otherRows(db,market,id){const hash=crypto.createHash('sha256');let count=0;for(const row of await db.all('SELECT * FROM creators WHERE NOT(region=? AND creator_id=?) ORDER BY id',[market,id])){hash.update(JSON.stringify(row));count++;}return {count,digest:hash.digest('hex')};}
async function main(){
 const [input,file,directory,confirm]=process.argv.slice(2);
 if(confirm!=='--write-library'||![input,file,directory].every(p=>p&&path.isAbsolute(p))||!fs.existsSync(file)||fs.existsSync(directory))throw new Error('Explicit existing DB and new output directory required');
 const observation=JSON.parse(fs.readFileSync(input,'utf8'));const {creatorId:id,market}=observation;
 let db=await existingDatabase(file);
 try{
  const old=await db.partnerProfileRaw(market,id);const built=buildPageObservationPatch(observation,old,market,id);
  fs.mkdirSync(directory,{recursive:false});
  const backup=path.join(directory,'creators-before-page-enrichment.db');
  await db.run('VACUUM INTO ?',[backup]);
  const check=await existingDatabase(backup);try{assert.equal(Object.values(await check.get('PRAGMA quick_check'))[0],'ok');assert.deepEqual(await check.partnerProfileRaw(market,id),old);}finally{await check.close();}
  const before=await otherRows(db,market,id);const totalBefore=(await db.get('SELECT COUNT(*) n FROM creators')).n;
  assert.equal((await db.updatePartnerProfile(market,id,built.patch)).saved,1);
  await db.close();db=await existingDatabase(file);
  const stored=await db.partnerProfileRaw(market,id);for(const [key,value]of Object.entries(built.displayPatch))assert.deepEqual(stored[key],value,key);
  for(const key of CONTACT_KEYS)assert.deepEqual(stored[key],old[key],key);
  assert.deepEqual(stored.partner_checkpoint_json,old.partner_checkpoint_json);
  assert.deepEqual(stored.partner_profile_completed_at,old.partner_profile_completed_at);
  assert.deepEqual(await otherRows(db,market,id),before);
  assert.equal((await db.get('SELECT COUNT(*) n FROM creators')).n,totalBefore);
  const rows=[];const add=(scope,label,value,status='已获取（页面）',source='正常详情页',period=observation.period)=>rows.push({'范围':scope,'字段':label,'原始值':String(value??''),'状态':status,'来源':source,'统计区间':period});
  const names={handle:'达人账号',nickname:'昵称',follower_cnt:'粉丝数',creator_level:'达人等级',is_fast_growing:'快速成长榜',sales:'销量',cooperation:'合作指标',allVideo:'全部视频',allLive:'全部直播',productVideo:'仅带货视频',productLive:'仅带货直播',follower_genders_v2:'粉丝性别',follower_ages_v2:'粉丝年龄',industry_groups:'销售类目占比',content_groups:'销售渠道占比',follower_state_location:'完整粉丝地区',partner_trend_json:'趋势明细',top_video_data:'热门视频',ec_top_video_data:'电商视频'};
  add('身份','达人 ID',id,'已获取（页面）','详情页 URL','');add('身份','库中已核验地区',market,'已保留','既有核验记录','');
  for(const [k,v]of Object.entries(built.safe.base))add('基础资料',names[k]||k,v,'已获取（页面）','正常详情页','');
  for(const [scope,values]of Object.entries(built.safe.groups))for(const [k,v]of Object.entries(values))add(names[scope],k,v,built.status[scope+'.'+k]);
  for(const [scope,values]of Object.entries(built.safe.distributions))for(const row of values)add(names[scope],row.label,row.percent,'已获取（页面）','正常详情页',scope.startsWith('follower_')?'':observation.period);
  for(const key of built.safe.pageEmptySections)add('页面暂无数据',names[key],'',built.status[key]);
  for(const key of built.safe.uncollected)add('待完成',names[key]||key,'','未采集');
  for(const key of ['合作邮箱','whatsapp','line'])add('已有联系方式',key,stored[key],stored[key]?'已保留':'既有记录为空','此前联系方式核验','');
  const csv=path.join(directory,'页面资料核验.csv'),xlsx=path.join(directory,'页面资料核验.xlsx');
  const headers=Object.keys(rows[0]);await exportCsv(csv,rows,headers);await exportXlsx(xlsx,rows,headers);
  const book=new(require('exceljs').Workbook)();await book.xlsx.readFile(xlsx);rows.forEach((row,i)=>headers.forEach((key,j)=>assert.equal(String(book.worksheets[0].getCell(i+2,j+1).value??''),row[key])));
  fs.writeFileSync(path.join(directory,'reviewed-page-observation.json'),JSON.stringify(built.safe,null,2));
  const summary={saved:1,libraryTotal:totalBefore,otherRowsUnchanged:before.count,contactsPreserved:true,readbackVerified:true,exportReadbackVerified:true,fullProfileCompleted:!!stored.partner_profile_completed_at,networkRequests:0,backup,csv,xlsx};
  fs.writeFileSync(path.join(directory,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
 }finally{await db.close();}
}
main().catch(error=>{console.error('Reviewed-page persistence failed; existing backup and records preserved. Code: '+(error.code||'VALIDATION'));process.exitCode=1;});
