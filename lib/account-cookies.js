(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AccountCookies = factory();
})(typeof globalThis === 'object' ? globalThis : this, function() {
  'use strict';
  const countries = [['US','美国 / United States'],['GB','英国 / United Kingdom'],['MY','马来西亚 / Malaysia'],
    ['TH','泰国 / Thailand'],['VN','越南 / Vietnam'],['SG','新加坡 / Singapore'],['PH','菲律宾 / Philippines'],
    ['ID','印度尼西亚 / Indonesia'],['MX','墨西哥 / Mexico'],['BR','巴西 / Brazil'],['JP','日本 / Japan'],
    ['ES','西班牙 / Spain'],['IT','意大利 / Italy'],['DE','德国 / Germany'],['FR','法国 / France'],
    ['IE','爱尔兰 / Ireland'],['PL','波兰 / Poland'],['BE','比利时 / Belgium'],['NL','荷兰 / Netherlands'],
    ['AT','奥地利 / Austria'],['CZ','捷克 / Czechia'],['GR','希腊 / Greece'],['PT','葡萄牙 / Portugal'],['HU','匈牙利 / Hungary']];
  const region = value => String(value || '').trim().toUpperCase().replace(/^UK$/, 'GB');
  function parse(raw) {
    const items = JSON.parse(String(raw).replace(/^\uFEFF/, ''));
    if (!Array.isArray(items) || !items.length || items.some(c => !c || typeof c.name !== 'string' || typeof c.value !== 'string'))
      throw new Error('Cookie 必须是非空的 JSON 数组');
    return items;
  }
  function normalize(entries) {
    if (!Array.isArray(entries)) throw new Error('账号列表无效');
    return entries.map((entry, index) => {
      const data = typeof entry === 'string' ? entry : entry.data;
      parse(data);
      const market = region(entry?.region);
      if (market && !/^[A-Z]{2}$/.test(market)) throw new Error('请选择两位国家代码');
      return {data, region:market, name:String(entry?.name || `账号 ${index + 1}`).slice(0,80)};
    });
  }
  function select(entries, market) {
    const accounts = normalize(entries), target = region(market);
    if (!/^[A-Z]{2}$/.test(target)) throw new Error('请先选择任务的目标国家。');
    if (!accounts.length) throw new Error('请先导入采集 Cookie，或导入本次运行的团长授权。');
    // A country label is a preference, NOT evidence of exclusive market access.
    // Target-site preflight decides which sessions actually work in this market.
    const ordered = [...accounts.filter(c => c.region === target), ...accounts.filter(c => c.region !== target)];
    const seen = new Set();
    return ordered.filter(account => {
      const cookies = parse(account.data);
      const sessions = cookies.filter(c => /^(sessionid|sessionid_ss|sid_tt)$/i.test(c.name));
      const identity = JSON.stringify((sessions.length ? sessions : cookies)
        .map(c => [c.domain || '', c.path || '/', c.name, c.value]).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
      if (seen.has(identity)) return false;
      seen.add(identity); return true;
    });
  }
  function summary(raw, now = Date.now()) {
    const cookies = parse(raw);
    // Optional tracking cookies expiring earlier do NOT invalidate the account.
    const sessions = cookies.filter(c => /^(sessionid|sessionid_ss|sid_tt)$/i.test(c.name));
    const expirations = sessions.map(c => Number(c.expirationDate || c.expires)).filter(v => v > 0 && Number.isFinite(v));
    const expiresAt = expirations.length ? Math.max(...expirations) * 1000 : null;
    return {count:cookies.length, expiresAt, expired:expiresAt != null && expiresAt <= now};
  }
  function source(raw) {
    const domains = parse(raw).map(c => String(c.domain || '').replace(/^\./,'').toLowerCase());
    return domains.some(d => /^partner(?:\.(?:us|eu))?\.tiktokshop\.com$/.test(d)) ? 'partner' : 'seller';
  }
  return {countries, region, parse, normalize, select, summary, source};
});
