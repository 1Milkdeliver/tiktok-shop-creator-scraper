'use strict';
const {ContactError} = require('./partner-contacts');
const {normalizeValue} = require('./exporter');
const {FIELDS} = require('./partner-profile-fields');
const SECTIONS = Object.freeze([
  {key:'basic',name:'基础资料',types:[1,6],expected:['creator_oecuid','handle','nickname','follower_cnt','category','bio','creator_bind_mcn_name','selection_region','last_publish_time']},
  {key:'performance',name:'带货、视频和直播指标',types:[2],expected:['med_gmv_revenue','med_gmv_revenue_range','units_sold','gpm','video_engagement','ec_live_avg_uv']},
  {key:'audience',name:'粉丝画像',types:[3],expected:['follower_ages_v2','follower_genders_v2','follower_state_location']},
  {key:'trend',name:'趋势明细',types:[4],expected:[]},
  {key:'videos',name:'示例视频',types:[5],expected:['top_video_data','ec_top_video_data']},
]);
const LEGACY = ['handle','nickname','creator_oecuid','selection_region','follower_cnt','category','med_gmv_revenue','med_gmv_revenue_range','video_gmv','live_gmv','units_sold','units_sold_range','video_avg_view_cnt','video_play_cnt_med','video_engagement','ec_video_engagement','ec_video_gpm','ec_live_gpm','ec_live_avg_uv','top_follower_ages','top_follower_gender','pps_score','is_fast_growing','has_collaborated','creator_permission_tag','is_live_auction','last_publish_time'];
const ALIASES = {bio:'简介',creator_bind_mcn_name:'MCN机构',vertical_pro_category:'垂直类目'};
const DISPLAY_KEYS = new Set([...LEGACY,...FIELDS.map(f=>f.k)]);
const FORBIDDEN = /^(?:__proto__|prototype|constructor|cookie|cookies|headers|authorization|sessionid|sessionid_ss|sid_tt|access_token|refresh_token)$/i;
// Keep authorized data, not restricted wrapper values; never fetch media binaries.
function permitted(value, depth=0) {
  if (depth>20) throw new ContactError('PROFILE_FORMAT','资料嵌套过深，已停止。');
  if (!value || typeof value!=='object') return value;
  if (value.is_authorized === false) return {is_authorized:false,status:value.status};
  if (Array.isArray(value)) return value.map(v=>permitted(v,depth+1));
  return Object.fromEntries(Object.entries(value).filter(([k])=>!FORBIDDEN.test(k)).map(([k,v])=>[k,permitted(v,depth+1)]));
}
function available(value) { return value !== undefined && value !== null && value !== '' && !(Array.isArray(value)&&!value.length) && !(value&&typeof value==='object'&&!Object.keys(value).length); }
function unwrap(value) { if (value&&typeof value==='object'&&!Array.isArray(value)&&Object.hasOwn(value,'is_authorized')) return value.is_authorized===false ? undefined : value.value; return value; }
function parseSection(response, section, creatorId, region) {
  const data=response?.data?.creator_profile !== undefined || response?.data?.creator_profile_trend_data !== undefined ? response.data : response;
  const profile=data?.creator_profile, trend=data?.creator_profile_trend_data;
  if (section.key==='trend' ? !Array.isArray(trend) : !profile || typeof profile!=='object' || Array.isArray(profile) || !Object.keys(profile).length) throw new ContactError('PROFILE_FORMAT','平台未返回有效'+section.name+'，未计为完成。');
  const returnedId=unwrap(profile?.creator_oecuid);
  if (section.key==='basic' && returnedId===undefined) throw new ContactError('PROFILE_ID','基础资料缺少达人 ID，未写入。');
  if (returnedId!==undefined && (typeof returnedId!=='string' || returnedId!==creatorId)) throw new ContactError('PROFILE_ID','详情返回的达人 ID 不匹配，未写入。');
  const safe=permitted(profile||{}), patch={}, status={};
  for (const key of new Set([...section.expected,...Object.keys(safe)])) {
    if (FORBIDDEN.test(key)) continue;
    const wrapped=safe[key], value=unwrap(wrapped), mapped=ALIASES[key]||key;
    status[key]=wrapped?.is_authorized===false?'无权限':available(value)?'已获取':'未提供';
    if (status[key]==='已获取' && (ALIASES[key] || DISPLAY_KEYS.has(key)) && !mapped.startsWith('partner_')) patch[mapped]=value;
  }
  // Never guess creator location from market; keep market as a separate provenance field.
  patch.partner_market=region;
  if (section.key==='trend') patch.partner_trend_json=JSON.stringify(permitted(trend));
  const metadata=Object.fromEntries(Object.entries(data||{}).filter(([k])=>!['creator_profile','creator_profile_trend_data','code','message','msg','log_id'].includes(k)&&!FORBIDDEN.test(k)));
  return {patch,details:{profile:safe,metadata:permitted(metadata)},status};
}
function display(value) {
  // Preserve nested distributions and percentages without the seller formatter's /100 heuristic.
  return value && typeof value==='object' && (Array.isArray(value)||(!Object.hasOwn(value,'format')&&!Object.hasOwn(value,'value')&&!Object.hasOwn(value,'minimal')&&!Object.hasOwn(value,'maximum'))) ? JSON.stringify(value) : normalizeValue(value);
}
function exactNumeric(value) {
  const v=value&&typeof value==='object'?value.value:value;
  if (typeof v==='number') return Number.isFinite(v)?v:null;
  return typeof v==='string' && /^-?\d+(?:\.\d+)?$/.test(v.trim()) ? Number(v) : null;
}
module.exports={SECTIONS,parseSection,permitted,display,exactNumeric};
