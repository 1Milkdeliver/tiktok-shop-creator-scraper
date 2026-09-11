(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.PartnerProfileFields=api;})(typeof window!=='undefined'?window:this,function(){
  'use strict';
  const definitions = [
    ['partner_market','资料采集站点','Profile Source Market'],
    ['partner_discovery_json','发现接口原始字段 JSON','Discovery Response Fields JSON'],
    ['partner_report_period','页面统计区间','Displayed Reporting Period'],['partner_page_checked_at','页面资料检查时间','Page Checked At'],
    ['partner_page_metrics_json','页面指标（区分全部与带货）','Page Metrics by Scope'],
    ['bio_url','简介链接','Bio URL'],['bounded_partner_name_offline','后台绑定机构','Bound Partner'],
    ['creator_level','达人等级','Creator Level'],['gpm','千次曝光成交金额','GPM'],['avg_revenue_per_buyer','客单价','Revenue per Buyer'],
    ['med_commission_rate','佣金率','Commission Rate'],['promoted_product_num','推广商品数','Promoted Products'],
    ['collaborated_brands_num','合作品牌数','Partnered Brands'],['product_price_range','商品价格区间','Product Price Range'],
    ['video_publish_cnt_30d','30天视频数','Videos (30d)'],['video_med_view_cnt','后台视频观看指标','Profile Video Views'],
    ['video_med_like_cnt','后台视频点赞指标','Profile Video Likes'],['video_med_comment_cnt','后台视频评论指标','Profile Video Comments'],['video_med_share_cnt','后台视频分享指标','Profile Video Shares'],
    ['live_streaming_cnt_30d','30天直播数','LIVE Streams (30d)'],['live_med_view_cnt','后台直播观看指标','Profile LIVE Views'],
    ['live_engagement','直播互动率','LIVE Engagement'],['live_med_like_cnt','后台直播点赞指标','Profile LIVE Likes'],
    ['live_med_comment_cnt','后台直播评论指标','Profile LIVE Comments'],['live_med_share_cnt','后台直播分享指标','Profile LIVE Shares'],
    ['ec_video_publish_cnt','带货视频数','Product Videos'],['ec_video_avg_view_cnt','带货视频平均播放','Product Video Avg Views'],
    ['ec_video_avg_like_cnt','带货视频平均点赞','Product Video Avg Likes'],['ec_video_avg_comment_cnt','带货视频平均评论','Product Video Avg Comments'],
    ['ec_live_streaming_cnt','带货直播数','Product LIVE Streams'],['ec_live_avg_like_cnt','带货直播平均点赞','Product LIVE Avg Likes'],['ec_live_avg_comment_cnt','带货直播平均评论','Product LIVE Avg Comments'],
    ['follower_ages_v2','完整粉丝年龄分布','Full Audience Ages'],['follower_genders_v2','完整粉丝性别分布','Full Audience Genders'],
    ['follower_state_location','粉丝地区分布','Audience Locations'],['industry_groups','销售类目分布','Sales Categories'],['content_groups','销售渠道分布','Sales Channels'],
    ['top_video_data','示例视频资料','Sample Videos'],['ec_top_video_data','带货示例视频资料','Product Sample Videos'],
    ['partner_trend_json','趋势明细 JSON','Trend Details JSON'],['partner_details_json','完整详情 JSON','Full Profile JSON'],
    ['partner_field_status','字段采集状态 JSON','Field Status JSON'],['partner_profile_status','完整采集状态','Full Collection Status'],
    ['partner_profile_checked_at','资料检查时间','Profile Checked At'],['partner_profile_completed_at','全部模块完成时间','All Modules Completed At'],
  ];
  const FIELDS=Object.freeze(definitions.map(([k,n,e])=>Object.freeze({k,n,e,partner:true})));
  const LABELS=Object.freeze(Object.fromEntries(FIELDS.map(f=>[f.k,{zh:f.n,en:f.e}])));
  return {FIELDS,LABELS};
});
