/* Uses the original page's shared language and library-filter state. */
(() => {
  'use strict';
  Object.assign(I18N, {
    'contacts.title':{zh:'补全资料与联系方式',en:'Enrich profiles & contacts'},
    'contacts.mode':{zh:'补全内容',en:'Enrichment scope'},
    'contacts.only':{zh:'仅联系方式',en:'Contacts only'},
    'contacts.full':{zh:'完整资料 + 联系方式（待实测）',en:'Full profile + contacts (pending live validation)'},
    'contacts.subtitle':{zh:'对达人库中已发现的达人，读取团长后台允许查看的全部联系方式。',en:'Read all available contacts for creators already in your library, using your authorized Partner Center account.'},
    'contacts.close':{zh:'收起',en:'Collapse'},
    'contacts.hint':{zh:'WhatsApp、LINE、邮箱、Zalo、Viber、Facebook 及其他联系方式均独立保存。使用 Partner Center 团长 Cookie，不代发消息，不需要逐个打开聊天页面。空白不代表抓取成功，请结合“联系方式状态”查看。',en:'WhatsApp, LINE, email, Zalo, Viber, Facebook and other contacts are saved separately. Requires Partner Center cookies. No messages are sent and no chat pages are opened. Check Contact Status: blank fields do not imply success.'},
    'contacts.import':{zh:'导入团长 Cookie JSON',en:'Import Partner Cookie JSON'},
    'contacts.clear':{zh:'移除授权',en:'Remove authorization'},
    'contacts.private':{zh:'授权仅在本次软件运行期间保留；退出后需重新导入，不会写入导出文件或日志。',en:'Credentials stay in memory until you quit. Import again after restart. Never included in logs or exports.'},
    'contacts.market':{zh:'团长地区',en:'Partner market'},
    'contacts.unchecked':{zh:'跳过已检查达人（可继续未完成部分）',en:'Skip checked creators (resume unfinished work)'},
    'contacts.preview':{zh:'刷新范围',en:'Refresh scope'},
    'contacts.pacing':{zh:'不设固定条数上限：启动时锁定当前达人库筛选 ∩ 所选地区，去重后持续抓完该范围，不受表格分页影响。联系方式逐位入库，串行间隔 10 秒；完整模式逐模块保存。实际出现限流、验证或登录/权限异常时暂停。平台未提供的字段不覆盖已有值；普通卖家采集不变。',en:'No fixed creator limit: snapshot current library filters intersected with this market, deduplicate and process the entire scope, regardless of table pagination. Contacts are saved per creator, with 10 seconds between reads; full mode saves each module. Pause on actual throttling, verification or login/access errors. Missing fields preserve existing values. Seller collection is unchanged.'},
    'contacts.recovery':{zh:'仅联系方式模式：断网、超时或临时服务错误按 30 / 60 / 120 秒退避，之后每 5 分钟自动重试，可随时停止。限流和验证不自动重试；写库失败或返回结构异常也会保留进度暂停，不会假报完成。重启后重新导入授权，保持相同筛选并勾选“跳过已检查达人”续抓。',en:'Contacts only: network failures, timeouts and temporary server errors retry after 30 / 60 / 120 seconds, then every 5 minutes; Stop cancels recovery. Throttling and verification are not retried. Database or response-format errors also pause with progress preserved, never reported as complete. After restart, reimport authorization and use the same filters with Skip checked creators to resume.'},
    'contacts.start':{zh:'开始 / 继续补全',en:'Start / resume enrichment'},
    'contacts.stop':{zh:'停止并保留进度',en:'Stop and keep progress'},
  });
  const el = id => document.getElementById(id);
  const say = (zh,en) => uiLang === 'zh' ? zh : en;
  let scope = null, previewSequence = 0, polling = false, running = false, connected = false, submitting = false, lastCompleted = -1;
  const snapshotFilters = () => ({search:el('creatorSearch').value.trim(), activityStatus:el('creatorActiveOnly').checked ? 'active' : undefined, ...buildFieldFilters()});
  function buttons() {
    const busy = running || submitting;
    el('contactStart').disabled = busy || !connected || !scope?.total;
    el('contactStop').disabled = !running;
    for (const id of ['contactImport','contactRegion','contactMode','contactUnchecked','contactPreview']) el(id).disabled = busy;
    el('contactClear').disabled = busy || !connected;
    el('contactAuth').textContent = connected ? say('已导入 · 本次运行有效（开始时检查地区权限）','Imported · this run only (market access checked on start)') : say('未导入团长授权','No Partner credentials imported');
  }
  async function preview() {
    const sequence = ++previewSequence;
    scope = null; buttons();
    const payload = {filters:snapshotFilters(), region:el('contactRegion').value, mode:el('contactMode').value, onlyUnchecked:el('contactUnchecked').checked};
    el('contactScope').textContent = say('正在计算当前筛选范围…','Calculating current scope…');
    try {
      const result = await window.api.partnerContactsPreview(payload);
      if (sequence !== previewSequence) return false;
      if (!result.ok) throw new Error(result.error);
      scope = {...payload, total:result.total};
      el('contactScope').textContent = say(`待补全：${result.total.toLocaleString()} 位 · ${payload.region} · 当前筛选。`, `Pending: ${result.total.toLocaleString()} · ${payload.region} · current filters.`) + (result.total ? '' : say(' 此地区没有匹配的待补全达人，请检查地区和筛选条件。',' No pending creators match this market and filters.'));
      if (result.total) el('contactScope').textContent += say(' 不设固定条数上限，将处理全部匹配达人。',' No fixed creator limit; all matching creators will be processed.');
      el('contactScope').textContent += say(' “有邮箱 / 有 WhatsApp”仅影响展示和导出，不排除待补全达人；无联系方式也保留。',' Has email / Has WhatsApp affect viewing and export only; missing contacts never exclude or delete a creator.');
      if (payload.mode === 'full') el('contactScope').textContent += say(' 完整模式检查基础资料、带货/视频/直播指标、粉丝画像、趋势、示例视频及联系方式。当前详情接口实测仍要求验证，此模式尚未验证通过；遇到验证立即停止。勾选“跳过已检查”时按模块续抓，不会跳过仅补过联系方式的达人。',' Full mode checks identity, sales/video/LIVE metrics, audience, trends, sample videos and contacts. Live profile access still requires verification; this mode is not live-validated. Stops on verification. Resume skips only completed modules, not contact-only creators.');
      return true;
    } catch (error) { el('contactScope').textContent = error.message || say('读取范围失败','Cannot read scope'); return false; }
    finally { if (sequence === previewSequence) buttons(); }
  }
  async function pollContacts() {
    if (polling) return;
    polling = true;
    try {
      const status = await window.api.partnerContactsStatus();
      const wasRunning = running;
      running = status.running; connected = status.connected;
      el('contactProgress').textContent = say(`已保存 ${status.completed} / ${status.total} · 有联系方式 ${status.found} · 未提供 ${status.empty}`, `Saved ${status.completed} / ${status.total} · With contacts ${status.found} · Not provided ${status.empty}`) + (status.region ? ' · ' + status.region : '');
      if (status.mode === 'full') el('contactProgress').textContent = say(`全部模块已检查 ${status.completed} / ${status.total} 位 · 本轮已保存 ${status.sectionsSaved} 个模块`, `All modules checked: ${status.completed} / ${status.total} creators · ${status.sectionsSaved} modules saved this run`);
      const outcomes = {idle:say('尚未开始','Not started'),running:say('运行中','Running'),completed:say('当前范围已完成','Scope complete'),paused:say('已暂停，进度已保留','Paused; progress saved'),stopped:say('已停止，进度已保留','Stopped; progress saved')};
      el('contactProgress').textContent += ' · ' + (outcomes[status.outcome] || '') + say(` · 待完成 ${Math.max(0, status.total - status.completed)}`, ` · Remaining ${Math.max(0, status.total - status.completed)}`);
      if (status.retryAt) el('contactProgress').textContent += say(` · 网络恢复等待：${Math.max(0, Math.ceil((Date.parse(status.retryAt) - Date.now()) / 1000))} 秒后重试`, ` · Recovering: retry in ${Math.max(0, Math.ceil((Date.parse(status.retryAt) - Date.now()) / 1000))}s`);
      const log = el('contactLog'), atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 36;
      const text = status.logs.join('\n') || say('尚未开始。任务执行后，这里显示实时进度；不显示联系方式原值。','Not started. Live progress will appear here without contact values.');
      if (log.textContent !== text) { log.textContent = text; if (atBottom) log.scrollTop = log.scrollHeight; }
      const revision = status.completed + ':' + (status.sectionsSaved || 0);
      if (revision !== lastCompleted && activePage === 'creators' && status.total) { lastCompleted = revision; await loadCreators(); }
      if (wasRunning && !running) { await preview(); await refreshDatabaseMetrics(); }
    } catch (_) { el('contactProgress').textContent = say('无法读取联系方式任务状态，请检查软件是否已更新。','Cannot read contact status. Check that the app is up to date.'); }
    finally { polling = false; buttons(); }
  }
  el('contactOpen').onclick = async () => {
    el('contactPanel').classList.add('open'); el('contactOpen').setAttribute('aria-expanded','true');
    el('contactPanel').scrollIntoView({block:'start'});
    await pollContacts(); if (!running) await preview(); el('contactClose').focus({preventScroll:true});
  };
  el('contactClose').onclick = () => { el('contactPanel').classList.remove('open'); el('contactOpen').setAttribute('aria-expanded','false'); el('contactOpen').focus(); };
  el('contactImport').onclick = async () => {
    submitting = true; buttons();
    try { const result = await window.api.importPartnerContactsCookie(); if (!result.ok && !result.canceled) el('contactProgress').textContent = result.error; else await pollContacts(); }
    catch (_) { el('contactProgress').textContent = say('导入失败，请重试。','Import failed. Try again.'); }
    finally { submitting = false; buttons(); }
  };
  el('contactClear').onclick = async () => { const result = await window.api.clearPartnerContactsCookie(); if (result.ok) await pollContacts(); else el('contactProgress').textContent = result.error; };
  for (const id of ['contactRegion','contactMode','contactUnchecked']) el(id).onchange = preview;
  el('contactPreview').onclick = preview;
  el('contactStart').onclick = async () => {
    submitting = true; buttons();
    try {
      if (!await preview() || !scope.total) return;
      if (scope.mode === 'full' && !confirm(say('完整模式尚未通过真实详情验证。将逐模块读取并保存当前筛选达人的完整资料和联系方式，不保证平台提供每个字段。遇到验证或额度限制即停止，不会自动重试。是否测试？','Full mode has not passed live profile validation. It saves available profile modules and contacts; not every field is guaranteed. It stops on verification or quotas without retries. Test this mode?'))) return;
      if (scope.mode !== 'full' && !confirm(say(`将持续补全当前筛选中的全部 ${scope.total} 位 ${scope.region} 达人，不设固定条数上限，逐位入库并保留进度。实际出现限流、验证或登录/权限异常时暂停；写库失败或返回结构异常也会暂停。确定开始吗？`, `Process all ${scope.total} filtered creators in ${scope.region}, without a fixed creator limit, saving each creator and keeping progress? Pauses on actual throttling, verification, login/access errors, failed writes or invalid responses.`))) return;
      const result = await window.api.startPartnerContacts({...scope,expectedTotal:scope.total});
      if (!result.ok) el('contactProgress').textContent = result.error;
      else await pollContacts();
    } catch (_) { el('contactProgress').textContent = say('启动失败，请刷新范围后重试。','Could not start. Refresh scope and retry.'); }
    finally { submitting = false; buttons(); }
  };
  el('contactStop').onclick = async () => { await window.api.stopPartnerContacts(); await pollContacts(); };
  document.addEventListener('DOMContentLoaded', pollContacts);
  setInterval(() => { if (running || el('contactPanel').classList.contains('open')) pollContacts(); },1500);
})();
