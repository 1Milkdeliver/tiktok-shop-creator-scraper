'use strict';
// A single scoped request. Report only the schema, never credentials/identities/contacts.
const fs=require('node:fs');
const {CreatorDatabase}=require('../lib/database');
const {PartnerContactClient}=require('../lib/partner-contacts');
(async()=>{
  const db=new CreatorDatabase(process.env.APPDATA+'/tiktok-shop-creator-scraper/data/creators.db');
  try{
    await db.open();
    const target=await db.get("SELECT c.creator_id FROM creators c JOIN scrape_job_creators j ON j.creator_row_id=c.id WHERE j.job_id=? AND COALESCE(json_extract(c.raw_json,'$.contact_checked_at'),'')='' ORDER BY c.id LIMIT 1",['601c7819-0f31-46a2-8866-d2dab057017e']);
    if(!target)throw new Error('No pending test target');
    const client=new PartnerContactClient(JSON.parse(fs.readFileSync('C:/Users/Huawei/Desktop/json.txt','utf8')));
    const request=client.request.bind(client);
    client.request=async(...args)=>{
      const j=await request(...args);
      if(args[0].includes('cmp/contact'))console.log(JSON.stringify({code:j.code,topKeys:Object.keys(j),
        dataKeys:j.data&&Object.keys(j.data),
        contactInfoType:Array.isArray(j.contact_info)?'array':j.contact_info===null?'null':typeof j.contact_info,
        nestedContactInfoType:Array.isArray(j.data?.contact_info)?'array':j.data?.contact_info===null?'null':typeof j.data?.contact_info,
        contactInfoCount:Array.isArray(j.contact_info)?j.contact_info.length:null,
        messageIsSuccess:/^success$|^ok$/i.test(j.message||'')}));
      return j;
    };
    try{
      const patch=await client.fetchContacts('MY',target.creator_id);
      console.log(JSON.stringify({fetch:'success',hasWhatsapp:!!patch.whatsapp,hasEmail:!!patch['合作邮箱'],status:patch.contact_status}));
    }catch(e){console.log(JSON.stringify({fetch:'failed',code:e.code,message:e.message}));}
  }finally{await db.close();}
})().catch(()=>{console.log('LOCAL_CHECK_FAILED');process.exitCode=1;});
