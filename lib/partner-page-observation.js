'use strict';
// Offline mapping of a reviewed, rendered detail page. Not an API response and
// never a full-profile checkpoint. No browser, Cookie or network access here.
const {FIELDS}=require('./partner-profile-fields');
const {display}=require('./partner-profile');
const MAPPINGS={
  sales:{'GMV':'med_gmv_revenue','成交件数':'units_sold','千次曝光成交金额':'gpm','客单价':'avg_revenue_per_buyer'},
  cooperation:{'平均佣金率':'med_commission_rate','商品':'promoted_product_num','品牌合作':'collaborated_brands_num','商品价格':'product_price_range'},
  allVideo:{'平均视频播放量':'video_avg_view_cnt','视频平均互动率':'video_engagement'},
  allLive:{'直播平均互动率':'live_engagement'},
  productVideo:{'视频GPM':'ec_video_gpm','视频数':'ec_video_publish_cnt','平均视频播放量':'ec_video_avg_view_cnt','视频平均互动率':'ec_video_engagement'},
  productLive:{'直播 GPM':'ec_live_gpm','直播数':'ec_live_streaming_cnt'},
};
const BASE_KEYS=['handle','nickname','follower_cnt','creator_level','is_fast_growing','简介','MCN机构'];
const DISTRIBUTIONS=['follower_genders_v2','follower_ages_v2','industry_groups','content_groups'];
function objectJson(value) {
  if(!value)return {};
  const parsed=JSON.parse(value);
  if(!parsed||Array.isArray(parsed)||typeof parsed!=='object')throw new Error('Existing profile metadata is invalid');
  return parsed;
}
function buildPageObservationPatch(observation,existing,region,id) {
  if(!existing||observation.version!==1||observation.creatorId!==id||observation.market!==region||
    typeof id!=='string'||observation.base?.handle!==existing.handle)throw new Error('Observation identity mismatch');
  const url=new URL(observation.sourceUrl);
  if(url.protocol!=='https:'||url.hostname!=='partner.tiktokshop.com'||url.pathname!=='/affiliate-cmp/creator/detail'||url.searchParams.get('cid')!==id)throw new Error('Invalid observed detail URL');
  if(!Number.isFinite(Date.parse(observation.observedAt))||typeof observation.period!=='string'||!observation.period.trim())throw new Error('Observation time and displayed period required');
  const details=objectJson(existing.partner_details_json),statuses=objectJson(existing.partner_field_status);
  const patch={},currentStatus={},safe={version:1,source:'reviewed_browser_dom',creatorId:id,market:region,observedAt:observation.observedAt,
    sourceUrl:url.origin+url.pathname+'?cid='+id,period:observation.period,base:{},groups:{},distributions:{},uncollected:[]};
  const scalar=v=>typeof v==='string'||typeof v==='boolean'||(typeof v==='number'&&Number.isFinite(v));
  for(const key of BASE_KEYS) {
    const value=observation.base[key];
    if(value!==undefined&&value!==''&&scalar(value)) {patch[key]=value;safe.base[key]=value;currentStatus[key]='已获取（页面）';}
  }
  for(const group of Object.keys(MAPPINGS)) {
    const values=observation.groups?.[group];
    if(!values||typeof values!=='object'||Array.isArray(values))continue;
    safe.groups[group]={};
    for(const [label,value] of Object.entries(values)) {
      // Labels are saved as literal data; unknown page labels never become DB columns.
      if(label.length>100||!scalar(value)||String(value).length>1000||['__proto__','constructor','prototype'].includes(label))throw new Error('Invalid visible metric');
      safe.groups[group][label]=value;
      const key=MAPPINGS[group][label];
      const unavailable=value==='--'||value==='';
      currentStatus[group+'.'+label]=unavailable?'页面未显示值（原因未确认）':'已获取（页面）';
      if(key){currentStatus[key]=currentStatus[group+'.'+label];if(!unavailable)patch[key]=value;}
    }
  }
  for(const key of DISTRIBUTIONS) {
    const rows=observation.distributions?.[key];if(rows===undefined)continue;
    if(!Array.isArray(rows)||rows.length>50||rows.some(r=>typeof r.label!=='string'||r.label.length>100||typeof r.percent!=='string'||!/^\d+(\.\d+)?%$/.test(r.percent)||parseFloat(r.percent)>100))throw new Error('Invalid visible distribution');
    const value=rows.map(({label,percent})=>({label,percent}));
    safe.distributions[key]=value;patch[key]=value;currentStatus[key]='已获取（页面）';
  }
  const knownKeys=new Set(FIELDS.map(f=>f.k));
  for(const key of observation.uncollected||[]) {
    if(typeof key!=='string'||!knownKeys.has(key))throw new Error('Unknown uncollected field');
    safe.uncollected.push(key);currentStatus[key]='未采集（页面观察不完整）';
  }
  safe.pageEmptySections=[];
  for(const key of observation.pageEmptySections||[]) {
    if(!['top_video_data','ec_top_video_data'].includes(key))throw new Error('Unknown empty page section');
    safe.pageEmptySections.push(key);currentStatus[key]='页面显示暂无视频（接口明细未核验）';
  }
  // New page evidence is separate from API sections and cannot complete/skip them.
  details.browserObservation=safe;statuses.browserObservation=currentStatus;
  patch.partner_details_json=JSON.stringify(details);
  patch.partner_field_status=JSON.stringify(statuses);
  patch.partner_page_metrics_json=JSON.stringify(safe.groups);
  patch.partner_report_period=safe.period;
  patch.partner_page_checked_at=safe.observedAt;
  if(!existing.partner_profile_completed_at)patch.partner_profile_status='部分完成：已保存页面可见资料；完整接口流程待验证';
  return {patch,safe,status:currentStatus,displayPatch:Object.fromEntries(Object.entries(patch).map(([k,v])=>[k,display(v)]))};
}
module.exports={buildPageObservationPatch};
