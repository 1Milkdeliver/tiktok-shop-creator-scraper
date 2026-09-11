'use strict';
const {setTimeout:delay}=require('timers/promises');
const {ContactError}=require('./partner-contacts');
const {SECTIONS,parseSection}=require('./partner-profile');

function objectJson(text) {
  if (!text) return {};
  try { const value=JSON.parse(text); if (value && typeof value==='object' && !Array.isArray(value)) return value; } catch (_) {}
  throw new ContactError('CHECKPOINT','本地资料进度格式异常，已停止；现有数据保留。');
}

// Existing library enrichment only. No discovery, sending messages, retries or challenge bypass.
async function runFullProfile({job,client,db,region,targets,resume=true,signal}) {
  let requests=0;
  const pace=async()=>{
    if (requests++) { job.log('低频等待中；已获取模块已保存。'); await delay(job.intervalMs,undefined,{signal}); }
    if (signal.aborted) throw new ContactError('STOPPED','已停止，已获取资料保留。');
  };
  for (let i=0;i<targets.length;i++) {
    const id=targets[i], raw=await db.partnerProfileRaw(region,id);
    if (!raw) throw new ContactError('SAVE','对应达人已不在库中，已停止。');
    const oldCheckpoint=resume?objectJson(raw.partner_checkpoint_json):{};
    const checkpoint=oldCheckpoint.version===1 ? oldCheckpoint : {version:1,sections:{}};
    if (!checkpoint.sections || typeof checkpoint.sections!=='object' || Array.isArray(checkpoint.sections)) throw new ContactError('CHECKPOINT','本地模块进度异常，已停止。');
    const details=objectJson(raw.partner_details_json), statuses=objectJson(raw.partner_field_status);
    details.version=1; details.sections ||= {};
    let step='准备';
    const save=async patch=>{
      const result=await db.updatePartnerProfile(region,id,patch);
      if (result.saved!==1) throw new ContactError('SAVE','资料未成功写入达人库，已停止，未计为完成。');
    };
    try {
      await save({partner_checkpoint_json:JSON.stringify(checkpoint),partner_profile_completed_at:null,partner_profile_status:'采集中'});
      for (const section of SECTIONS) {
        if (checkpoint.sections[section.key]) continue;
        step=section.name;
        await pace(); job.log('达人 '+(i+1)+' / '+targets.length+'：正在读取'+step+'。');
        const result=parseSection(await client.fetchProfileSection(region,id,section.types,signal),section,id,region);
        const checkedAt=new Date().toISOString();
        details.sections[section.key]={checkedAt,...result.details};
        statuses[section.key]=result.status;
        checkpoint.sections[section.key]=checkedAt;
        await save({...result.patch,partner_details_json:JSON.stringify(details),partner_field_status:JSON.stringify(statuses),partner_checkpoint_json:JSON.stringify(checkpoint),partner_profile_checked_at:checkedAt,partner_profile_status:'部分完成：'+step});
        job.state.sectionsSaved++; job.log(step+'已入库；本轮已保存 '+job.state.sectionsSaved+' 个模块。');
      }
      step='联系方式';
      if (!checkpoint.sections.contacts) {
        await pace(); job.log('达人 '+(i+1)+' / '+targets.length+'：正在读取全部联系方式。');
        const contact=await client.fetchContacts(region,id,signal);
        const saved=await db.updateCreatorContacts(region,id,contact);
        if (saved.saved!==1) throw new ContactError('SAVE','联系方式未入库，未计为完成。');
        checkpoint.sections.contacts=new Date().toISOString();
        checkpoint.contactStatus=contact.contact_status;
        await save({partner_checkpoint_json:JSON.stringify(checkpoint)});
        job.state.sectionsSaved++;
      }
      const completedAt=new Date().toISOString();
      await save({partner_profile_status:'全部模块已检查（详见字段状态）',partner_profile_completed_at:completedAt,partner_profile_checked_at:completedAt});
      job.state.completed++;
      job.state[checkpoint.contactStatus==='已获取'?'found':'empty']++;
      job.log('已完成并入库 '+job.state.completed+' / '+targets.length+' 位；未提供或无权限字段未作推测。');
    } catch (error) {
      const reason=signal.aborted?'STOPPED':error instanceof ContactError?error.code:'SAVE';
      // Failure metadata must not accidentally commit the in-memory checkpoint of an unsaved section.
      await save({partner_profile_status:'未完成：'+step+'（'+reason+'）',partner_profile_completed_at:null}).catch(()=>{});
      throw error;
    }
  }
}
module.exports={runFullProfile};
