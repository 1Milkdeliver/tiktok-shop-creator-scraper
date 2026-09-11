'use strict';
// Explicit small-sample API contract probe. No DB writes, retry, or contact read.
const fs = require('fs'), path = require('path');
const {PartnerContactClient, ContactError, decodeResponse} = require('../lib/partner-contacts');
(async () => {
  const [cookieFile, samplesFile, output, typesText = '1,6'] = process.argv.slice(2);
  if (!cookieFile || !samplesFile || !output) throw new Error('Pass Cookie file, observed samples, output JSON, profile types');
  if (fs.existsSync(output)) throw new Error('Output already exists');
  const samples = JSON.parse(fs.readFileSync(samplesFile,'utf8').replace(/^\uFEFF/,''));
  const sample = Array.isArray(samples) ? samples[0] : samples.samples?.[0];
  if (!sample?.region || !sample?.creator_oecuid) throw new Error('Missing observed sample');
  const client = new PartnerContactClient(JSON.parse(fs.readFileSync(cookieFile,'utf8').replace(/^\uFEFF/,'')));
  if (process.env.PROFILE_PROBE_DIAGNOSTIC === '1') client.transport = (url,headers,signal,options) => new Promise((resolve,reject) => {
    const req = require('https').request(url,{headers,signal,method:options.method},res=>{
      let body=''; res.on('data',c=>{body+=c;if(body.length>1024*1024)req.destroy();});
      res.on('end',()=>{try {
        const parsed=JSON.parse(body);
        if (String(parsed.code)!=='0') console.log(JSON.stringify({http:res.statusCode,code:parsed.code,reason:String(parsed.message||'').replace(/\d{5,}/g,'[id]').slice(0,300)}));
        resolve(decodeResponse(res.statusCode,res.headers,body));
      } catch(e){reject(e);} });
    });
    req.setTimeout(20000,()=>req.destroy());req.on('error',()=>reject(new ContactError('NETWORK','网络异常，已停止')));req.end(options.body);
  });
  const response = await client.fetchProfileSection(sample.region, sample.creator_oecuid, typesText.split(',').map(Number));
  const profile = response.creator_profile ?? response.data?.creator_profile;
  const data = {creator_profile:profile, creator_profile_trend_data:response.creator_profile_trend_data ?? response.data?.creator_profile_trend_data};
  fs.mkdirSync(path.dirname(output),{recursive:true});
  fs.writeFileSync(output,JSON.stringify(data,null,2),{flag:'wx'});
  console.log(JSON.stringify({code:response.code, rootKeys:Object.keys(response), fields:Object.fromEntries(Object.entries(profile||{}).map(([k,v])=>[k,{type:typeof v,keys:v&&typeof v==='object'?Object.keys(v):[],authorized:v?.is_authorized,status:v?.status}]))}));
})().catch(error => { console.error(error instanceof ContactError ? error.code+': '+error.message : 'Probe setup or local save failed'); process.exitCode=1; });
