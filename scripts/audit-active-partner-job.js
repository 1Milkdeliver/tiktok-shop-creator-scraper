'use strict';
// Read-only retained-library audit. Output contains counts, never creator values.
const sqlite=require('sqlite3');
const {FIELDS:profileFields}=require('../lib/partner-profile-fields');
const {FIELDS:contactFields}=require('../lib/contact-fields');
const {SECTIONS}=require('../lib/partner-profile');
const fields=[...new Set([
  'handle','nickname','creator_oecuid','selection_region','follower_cnt','category',
  'med_gmv_revenue','med_gmv_revenue_range','video_gmv','live_gmv','units_sold','units_sold_range',
  'video_avg_view_cnt','video_play_cnt_med','video_engagement','ec_video_engagement','ec_video_gpm',
  'ec_live_gpm','ec_live_avg_uv','top_follower_ages','top_follower_gender','pps_score','is_fast_growing',
  'has_collaborated','creator_permission_tag','is_live_auction','last_publish_time','简介','合作邮箱','mcn','垂直类目',
  ...profileFields.map(field=>field.k),...contactFields.map(field=>field.k)
].filter(Boolean))];
const present=value=>value!==undefined&&value!==null&&value!==''&&
  !(Array.isArray(value)&&value.length===0)&&!(typeof value==='object'&&!Object.keys(value).length);
async function audit(file){
  const db=await new Promise((resolve,reject)=>{
    const connection=new sqlite.Database(file,sqlite.OPEN_READONLY,error=>error?reject(error):resolve(connection));
  });
  const all=(sql,params=[])=>new Promise((resolve,reject)=>db.all(sql,params,(error,rows)=>error?reject(error):resolve(rows)));
  try{
    await all('BEGIN'); // One consistent snapshot while the app keeps writing.
    const [job]=await all('SELECT id,region,status,started_at FROM scrape_jobs ORDER BY started_at DESC LIMIT 1');
    if(!job)throw new Error('No job');
    const rows=await all('SELECT c.region,c.raw_json FROM creators c JOIN scrape_job_creators j ON j.creator_row_id=c.id WHERE j.job_id=?',[job.id]);
    const report={auditedAt:new Date().toISOString(),readOnly:true,jobStatus:job.status,region:job.region,
      rows:rows.length,wrongMarketRows:0,invalidJsonRows:0,profilesChecked:0,profilesCompletedThisRun:0,
      contactsChecked:0,contactsCheckedThisRun:0,contactsFound:0,contactsEmpty:0,
      sectionCounts:Object.fromEntries(SECTIONS.map(s=>[s.key,0])),
      sectionsCheckedThisRun:Object.fromEntries(SECTIONS.map(s=>[s.key,0])),
      fieldCounts:Object.fromEntries(fields.map(field=>[field,{present:0,missing:0}]))};
    for(const row of rows){
      if(row.region!==job.region)report.wrongMarketRows++;
      let raw;try{raw=JSON.parse(row.raw_json);}catch(_){report.invalidJsonRows++;continue;}
      if(raw.partner_profile_completed_at){report.profilesChecked++;if(Date.parse(raw.partner_profile_completed_at)>=Date.parse(job.started_at))report.profilesCompletedThisRun++;}
      if(raw.contact_checked_at){report.contactsChecked++;if(Date.parse(raw.contact_checked_at)>=Date.parse(job.started_at))report.contactsCheckedThisRun++;}
      if(raw.contact_status==='已获取')report.contactsFound++;
      if(raw.contact_status==='未提供')report.contactsEmpty++;
      let checkpoint;try{checkpoint=JSON.parse(raw.partner_checkpoint_json||'{}');}catch(_){checkpoint={};}
      for(const section of SECTIONS)if(checkpoint.sections?.[section.key]){
        report.sectionCounts[section.key]++;
        if(Date.parse(checkpoint.sections[section.key])>=Date.parse(job.started_at))report.sectionsCheckedThisRun[section.key]++;
      }
      for(const field of fields)report.fieldCounts[field][present(raw[field])?'present':'missing']++;
    }
    const [integrity]=await all('PRAGMA quick_check');report.databaseIntegrity=Object.values(integrity)[0];
    await all('ROLLBACK');return report;
  }finally{await new Promise((resolve,reject)=>db.close(error=>error?reject(error):resolve()));}
}
if(require.main===module){
  if(!process.argv[2]){console.error('Pass a retained creator database path.');process.exitCode=1;}
  else audit(process.argv[2]).then(report=>console.log(JSON.stringify(report,null,2))).catch(error=>{console.error(JSON.stringify({auditFailed:true,code:error.code||'AUDIT'}));process.exitCode=1;});
}
module.exports={audit};
