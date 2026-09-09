'use strict';

const https = require('https');
const { setTimeout: delay } = require('timers/promises');
const { parseContacts } = require('./contact-fields');
const ORIGIN = 'https://partner.tiktokshop.com';
const MARKETS = Object.freeze({ GB:3, ID:4, TH:5, MY:6, VN:7, PH:10, SG:13, US:100 });
const COMMON = { aid:'360019', app_name:'i18n_ecom_alliance', device_platform:'web' };
// Region routing observed in the published Partner Center frontend (2026-09-08).
const PROFILE_ORIGINS = new Set(['https://api-partner-sg.tiktokshop.com','https://partner.eu.tiktokshop.com','https://partner.us.tiktokshop.com']);

class ContactError extends Error {
  constructor(code, message) { super(message); this.name = 'ContactError'; this.code = code; }
}
function cookieHeader(cookies, pathname, now = Date.now(), hostname = 'partner.tiktokshop.com') {
  if (!Array.isArray(cookies)) throw new ContactError('COOKIE_FORMAT', '请导入 Cookie JSON 数组。');
  const applicable = cookies.filter(c => {
    if (!c || typeof c.name !== 'string' || typeof c.value !== 'string') return false;
    const domain = String(c.domain || '').toLowerCase();
    const bare = domain.replace(/^\./, '');
    if (!(domain.startsWith('.') && c.hostOnly !== true ? (hostname === bare || hostname.endsWith('.' + bare)) : bare === hostname)) return false;
    // Only this service's domain or its actual parent; never accept public suffix cookies.
    if (![hostname, 'tiktokshop.com'].includes(bare)) return false;
    const p = typeof c.path === 'string' && c.path.startsWith('/') ? c.path : '/';
    if (!(pathname === p || pathname.startsWith(p.endsWith('/') ? p : p + '/'))) return false;
    const expiry = c.expirationDate ?? c.expires;
    if (expiry !== undefined && Number(expiry) > 0 && Number(expiry) * 1000 <= now) return false;
    return /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(c.name) && !/[\x00-\x20\x7f;,]/.test(c.value);
  });
  if (!applicable.some(c => /^(sessionid|sessionid_ss|sid_tt)$/.test(c.name))) throw new ContactError('COOKIE_MISSING', '没有适用于 Partner Center 的有效登录会话，请重新导入团长 Cookie。');
  return applicable.sort((a,b) => String(b.path || '/').length - String(a.path || '/').length).map(c => c.name + '=' + c.value).join('; ');
}
function decodeResponse(status, headers, body) {
  if (headers['bdturing-verify']) throw new ContactError('CHALLENGE', '平台要求验证，已停止。请在 Partner Center 完成验证后再试。');
  if (status === 429) throw new ContactError('RATE_LIMIT', '平台限流，已停止。请等待平台恢复后再继续。');
  if (status === 401 || status === 403 || (status >= 300 && status < 400)) throw new ContactError('AUTH', '登录会话失效或没有访问权限，请检查团长授权。');
  if (status !== 200) throw new ContactError('HTTP', '联系方式请求失败，已停止（HTTP ' + status + '）。');
  let data;
  try { data = JSON.parse(body); } catch (_) { throw new ContactError('RESPONSE', '平台未返回有效数据，可能需要登录或验证，已停止。'); }
  if (!data || typeof data !== 'object' || !Object.hasOwn(data, 'code')) throw new ContactError('RESPONSE', '联系方式接口结构发生变化，已停止。');
  const code = String(data.code);
  if (['16005003','16005005'].includes(code)) throw new ContactError('QUOTA', '平台联系信息额度受限，已停止。请等待额度恢复后再继续。');
  if (['10000','16201010','16201025'].includes(code)) throw new ContactError('AUTH', '平台要求重新登录或验证，已停止，请检查团长账号。');
  if (code !== '0') throw new ContactError('API', '平台未允许读取联系方式，已停止（代码 ' + (/^\d{1,12}$/.test(code) ? code : '未知') + '）。');
  return data;
}
class PartnerContactClient {
  constructor(cookies, { request } = {}) {
    cookieHeader(cookies, '/');
    this.cookies = cookies;
    this.contexts = new Map();
    this.transport = request;
  }
  async request(pathname, params, signal, body) {
    const url = new URL(pathname, ORIGIN);
    if (url.origin !== ORIGIN && !(PROFILE_ORIGINS.has(url.origin) && url.pathname === '/api/v1/oec/affiliate/creator/marketplace/4partner/profile')) throw new ContactError('ORIGIN','请求地址不属于 Partner Center。');
    for (const [key,value] of Object.entries({ ...COMMON, ...params })) url.searchParams.set(key, value);
    const headers = { Accept:'application/json', Cookie:cookieHeader(this.cookies, url.pathname, Date.now(), url.hostname), Referer:ORIGIN + '/affiliate-cmp/creator' };
    const serialized = body === undefined ? undefined : JSON.stringify(body);
    const method = serialized === undefined ? 'GET' : 'POST';
    if (serialized !== undefined) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(serialized); }
    if (signal?.aborted) throw new ContactError('STOPPED', '已停止，已获取的联系方式已保存。');
    if (this.transport) return this.transport(url, headers, signal, {method, body:serialized});
    return new Promise((resolve, reject) => {
      const req = https.request(url, { headers, signal, method }, res => {
        let size = 0; const chunks = [];
        res.on('data', chunk => {
          size += chunk.length;
          if (size > 1024 * 1024) { req.destroy(); reject(new ContactError('RESPONSE', '平台返回内容过大，已停止。')); return; }
          chunks.push(chunk);
        });
        res.on('error', () => reject(new ContactError('NETWORK', '连接中断，已停止；已保存的数据不受影响。')));
        res.on('end', () => {
          try { resolve(decodeResponse(res.statusCode, res.headers, Buffer.concat(chunks).toString('utf8'))); }
          catch (error) { reject(error); }
        });
      });
      // Absolute deadline also covers DNS/TLS; no infinite waits or automatic retries.
      const timeout = setTimeout(() => req.destroy(new ContactError('TIMEOUT', '联系方式请求超时，已停止；稍后可继续。')), 20000);
      req.on('close', () => clearTimeout(timeout));
      req.on('error', error => reject(signal?.aborted ? new ContactError('STOPPED','已停止，已获取的联系方式已保存。') : error instanceof ContactError ? error : new ContactError('NETWORK','网络请求失败，已停止；请检查网络后继续。')));
      req.end(serialized);
    });
  }
  async resolvePartner(region, signal) {
    if (!Object.hasOwn(MARKETS, region)) throw new ContactError('MARKET','暂未适配此地区的团长联系方式接口。');
    if (this.contexts.has(region)) return this.contexts.get(region);
    const response = await this.request('/api/v1/affiliate/partner/info', {partner_type:'1'}, signal);
    const markets = response?.data?.partner_biz_role_info?.market_list;
    if (!Array.isArray(markets)) throw new ContactError('CONTEXT','无法读取团长地区授权，请检查 Cookie 是否来自 Partner Center。');
    const market = markets.find(m => Number(m.market_region) === MARKETS[region]);
    const role = Array.isArray(market?.type_list) ? market.type_list.find(r => Number(r.type) === 4) : null;
    const id = role?.partner_id;
    if (typeof id !== 'string' || !/^\d+$/.test(id)) throw new ContactError('MARKET_AUTH','当前团长账号没有所选地区的 TAP 授权，请切换地区或导入对应账号。');
    this.contexts.set(region, id); return id;
  }
  async fetchContacts(region, creatorId, signal) {
    if (typeof creatorId !== 'string' || !/^\d{1,30}$/.test(creatorId)) throw new ContactError('CREATOR_ID','达人 ID 无效，已停止。');
    const partner = await this.resolvePartner(region, signal);
    const response = await this.request('/api_sens/v1/affiliate/cmp/contact', {partner_id:partner, creator_oecuid:creatorId, scene:'11'}, signal);
    const rows = response.contact_info ?? response.data?.contact_info;
    if (!Array.isArray(rows)) throw new ContactError('RESPONSE','联系方式字段缺失，未将本次结果记为成功。');
    return parseContacts(rows);
  }
  async fetchProfileSection(region, creatorId, types, signal) {
    if (typeof creatorId !== 'string' || !/^\d{1,30}$/.test(creatorId)) throw new ContactError('CREATOR_ID','达人 ID 无效，已停止。');
    if (!Array.isArray(types) || !types.length || types.some(t => ![1,2,3,4,5,6].includes(t))) throw new ContactError('PROFILE_TYPE','资料模块无效。');
    const partner = await this.resolvePartner(region, signal);
    const origin = region === 'US' ? 'https://partner.us.tiktokshop.com' : region === 'GB' ? 'https://partner.eu.tiktokshop.com' : 'https://api-partner-sg.tiktokshop.com';
    return this.request(origin + '/api/v1/oec/affiliate/creator/marketplace/4partner/profile', {partner_id:partner}, signal, {creator_oec_id:creatorId, profile_types:types});
  }
}

class ContactJob {
  constructor({ intervalMs = 10000 } = {}) { this.intervalMs = intervalMs; this.state = {running:false, completed:0, total:0, found:0, empty:0, logs:[]}; }
  snapshot() { return { ...this.state, logs:[...this.state.logs] }; }
  log(text) { this.state.logs.push('[' + new Date().toLocaleTimeString('zh-CN',{hour12:false}) + '] ' + text); this.state.logs = this.state.logs.slice(-120); this.state.message = text; }
  start({ client, db, region, targets, mode = 'contacts', resume = true }) {
    if (this.state.running) throw new ContactError('BUSY','联系方式补全正在运行。');
    this.controller = new AbortController();
    this.state = {running:true, mode, region, completed:0, sectionsSaved:0, total:targets.length, found:0, empty:0, logs:[], startedAt:new Date().toISOString()};
    this.log('任务已提交，正在检查团长授权。');
    this.done = this.run({client,db,region,targets,mode,resume}, this.controller.signal);
    return this.snapshot();
  }
  stop() { this.controller?.abort(); }
  async run({ client, db, region, targets, mode, resume }, signal) {
    try {
      if (!targets.length) throw new ContactError('EMPTY','当前范围没有尚待补全的达人。');
      await client.resolvePartner(region, signal);
      if (mode === 'full') {
        await require('./partner-profile-job').runFullProfile({job:this,client,db,region,targets,resume,signal});
        this.log('全部资料模块已检查并保存；字段是否提供及权限情况请查看字段采集状态。');
        return;
      }
      for (let i = 0; i < targets.length; i++) {
        if (i) { this.log('低频等待中；联系方式已逐位保存。'); await delay(this.intervalMs, undefined, {signal}); }
        if (signal.aborted) throw new ContactError('STOPPED','已停止。');
        this.log('正在读取联系方式：' + (i + 1) + ' / ' + targets.length + '。');
        const patch = await client.fetchContacts(region, targets[i], signal);
        // Persist a completed response even if Stop arrives while SQLite is writing.
        const saved = await db.updateCreatorContacts(region, targets[i], patch);
        if (saved.saved !== 1) throw new ContactError('SAVE','对应达人已不在库中，已停止，未将未入库的数据计为成功。');
        this.state.completed++;
        this.state[patch.contact_status === '已获取' ? 'found' : 'empty']++;
        this.log('已保存 ' + this.state.completed + ' / ' + targets.length + '；有联系方式 ' + this.state.found + '，未提供 ' + this.state.empty + '。');
      }
      this.log('联系方式补全完成，结果已保存到达人库。');
    } catch (error) {
      const stopped = signal.aborted;
      this.state.errorCode = stopped ? 'STOPPED' : error instanceof ContactError ? error.code : 'SAVE';
      this.log(stopped ? '已停止，已保存的数据保留；默认跳过已检查达人，可继续未完成部分。' : error instanceof ContactError ? error.message : '保存资料失败，已停止；请检查本地磁盘，已保存的数据保留。');
    } finally { this.state.running = false; this.state.finishedAt = new Date().toISOString(); }
  }
}
module.exports = { PartnerContactClient, ContactJob, ContactError, cookieHeader, decodeResponse, MARKETS };
