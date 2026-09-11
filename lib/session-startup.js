'use strict';

function failure(code, message) { return Object.assign(new Error(message), {code}); }
// Runs inside the page, not in the Node process. Hidden login templates do not count.
function pageState() {
  const visible = selector => [...document.querySelectorAll(selector)].some(node => node.getClientRects().length);
  return {bodyLen:document.body?.innerText?.length || 0,
    hasLogin:visible('input[type="password"]') || /\/(?:login|sign-in)(?:\/|$)/i.test(location.pathname),
    challenge:visible('[id*="captcha"], [class*="captcha_verify"], iframe[src*="captcha"]')};
}
// Cancel both watchdogs when the operation settles; stop does not wait for CDP.
async function bounded(operation, {timeoutMs = 90000, isStopped = () => false} = {}) {
  let timeout, stop;
  try {
    return await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => {
      timeout = setTimeout(() => reject(failure('STARTUP_TIMEOUT', '账号启动超时')), timeoutMs);
      stop = setInterval(() => { if (isStopped()) reject(failure('STOPPED', '已停止启动')); }, 100);
    })]);
  } finally { clearTimeout(timeout); clearInterval(stop); }
}

async function prepareSession(runner, s, mode, isolated, openLandingPage) {
  // All accounts are reserved at startup: never borrow an account already running.
  runner.usedCookies.add(s.cookieFile);
  s.startupState = 'starting';
  for (let attempt = 0; attempt < 2 && !runner.stopped; attempt++) {
    let expired = false;
    try {
      runner.log(`会话 #${s.index + 1}: 正在检查登录与页面${attempt ? '（页面恢复 1/1）' : ''}…`);
      await bounded(async () => {
        if (!s.browser) {
          const opened = await runner.openSession(mode, s.cookieFile, s.index, isolated);
          // A late launch must not resurrect a canceled or timed-out session.
          if (expired || runner.stopped) { await opened.browser.close().catch(() => {}); return; }
          s.browser = opened.browser; s.profileDir = opened.profileDir;
        }
        const lp = await openLandingPage(s.browser, s.cookieFile, () => expired || runner.stopped);
        if (expired || runner.stopped) { await lp.page.close().catch(() => {}); return; }
        s.page = lp.page; s.sellerId = lp.sellerId || '';
        const state = await s.page.evaluate(pageState);
        if (expired || runner.stopped) return;
        if (state.challenge) throw failure('VERIFICATION', '页面要求验证，请手动完成后继续');
        if (state.hasLogin) throw failure('LOGIN_REQUIRED', '页面要求登录，请更新此账号 Cookie（账号已保留）');
        if (state.bodyLen < 200) throw failure('PAGE_NOT_READY', '页面未加载完成，不能据此判定 Cookie 失效');
        s.startupState = 'ready';
      }, {timeoutMs:runner.startupTimeoutMs || 90000, isStopped:() => runner.stopped});
      if (runner.stopped) break;
      runner.log(`会话 #${s.index + 1}: 页面就绪，等待分配任务。`);
      return true;
    } catch (error) {
      const terminal = ['LOGIN_REQUIRED','VERIFICATION','STOPPED'].includes(error.code);
      if (!terminal && attempt === 0 && /detached|context.*destroyed|navigation|timeout|PAGE_NOT_READY|Target closed|Session closed/i.test(error.code + ' ' + error.message)) {
        // Only transient page failures retry. Login/verification never auto-retry.
        runner.log(`会话 #${s.index + 1}: 页面连接中断，自动重建页面一次。`);
        if (s.page) await bounded(() => s.page.close(), {timeoutMs:2000}).catch(() => {});
        s.page = null;
        continue;
      }
      s.cookieInvalid = error.code === 'LOGIN_REQUIRED';
      s.startupState = error.code === 'VERIFICATION' ? 'verification' : s.cookieInvalid ? 'login_required' : 'failed';
      s.startupError = terminal ? error.message : '页面启动失败（已跳过，不删除账号）';
      runner.log(`⚠️ 会话 #${s.index + 1}: ${s.startupError}；继续检查其余账号。`);
      break;
    } finally { expired = true; }
  }
  s.done = true;
  if (s.browser) await bounded(() => s.browser.close(), {timeoutMs:3000}).catch(() => {});
  return false;
}

function distributeWork(ready, keywords, detail, creatorInput) {
  const assignments = new Map(), detailWorkers = [];
  if (!ready.length) return {assignments, detailWorkers};
  const sharded = keywords.length >= ready.length && !creatorInput?.length;
  ready.forEach((s, i) => {
    assignments.set(s.index, sharded ? keywords.filter((_, k) => k % ready.length === i) : keywords);
    if (!sharded && detail && i > 0 && !creatorInput?.length) detailWorkers.push(s.index);
  });
  return {assignments, detailWorkers};
}
module.exports = {bounded, pageState, prepareSession, distributeWork};
