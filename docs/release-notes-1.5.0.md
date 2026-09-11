## What's new in v1.5.0

- Collect contacts alongside seller discovery/details: each saved page immediately feeds a deduplicated, market-scoped contact queue. New tasks enable this option by default; existing configurations without the option remain disabled. Partner credentials are required. Direct contact reads do not open individual chat pages or send messages.
- Save every discovered creator, regardless of available contact information. Distinguish found, not provided and pending checks. Serialize database writes and preserve existing contacts against stale or empty profile refreshes.
- Continue the starting filter scope without a software-imposed creator cap, save each result and retain manual resume checkpoints. Remove the 500-ID truncation and premature sparse-page termination. Stop/pause controls handle both stages without silently restarting a stopped contact queue.
- Retry transient network/server failures with backoff. Actual verification, throttling, authentication/access failures, invalid responses and failed database writes still pause safely. Successful responses without a contact list now count as not provided instead of a fatal error.
- Explicitly use the stable GitHub update channel and prohibit downgrades. Keep the existing update flow: check → consent → differential download/reconstruction → hash verification → silent installation when idle or on exit. Missing/corrupt base caches or differential failures fall back to full download. Historical release assets remain unchanged.

### Compatibility and verification scope

- Pre-publication checks passed: 79 offline tests, dependency audit (0 known vulnerabilities), isolated packaged startup/IPC, synthetic old-library/export compatibility and installer metadata/hash checks. Actual old/new installers reconstructed correctly over loopback using differential HTTP ranges: 90.51% reused, about 11.65 MB of changed ranges. This is not an installation test. See the [verification record](https://github.com/1Milkdeliver/tiktok-shop-creator-scraper/blob/v1.5.0/docs/release-readiness-1.5.0.md).
- No dependency or database schema changes from 1.4.0: Electron 43.6.0, electron-updater 6.8.9, puppeteer-core 25.10.0, sqlite3 6.0.1 and electron-builder 26.15.3. Source builds require Node.js 22.12+; end users receive the runtime with the app.
- Keep the same icon, application identity and `%APPDATA%\tiktok-shop-creator-scraper` data directory. Back up locally before important upgrades; do not uninstall or clear the library. These checks do not install over the production application.
- A separate bounded Malaysian contact test retained 100 new creators. Of 95 attempted contact reads, 94 succeeded: 47 had WhatsApp, 54 had email (overlapping counts), and 35 had no provided contacts. A verification challenge on request 95 stopped the run, leaving 6 pending. Total discovery/contact time was 16m48s with a 10-second contact interval; database/export readback passed and previous records were preserved. This used a local Partner discovery test adapter, not a new production Partner discovery entry point. Full-detail requests were disabled.
- This is not a claim of unlimited platform access, 100% contact availability or all-field completeness. Full-profile enrichment remains experimental and off by default. Advanced library filters are not pre-discovery platform filters; task category groups remain search keywords. PPS/GPM, biography, agency and latest-publication availability are not established by the contact test.
- Credentials, creator records, databases and live-test artifacts are excluded from source and installers.

## 更新内容

- 新增边采集资料边抓联系方式：每页达人入库后立即加入本轮、同地区的去重队列，不等整轮结束。新任务默认开启，旧配置不自动开启；需导入团长会话。接口读取不逐位打开聊天页面，也不发送消息。
- 有无联系方式都保存；已取得、未提供和待检查分开记录。入库写入排队，避免并行采集或空资料覆盖已有联系方式。
- 按启动时的范围持续处理，不设软件固定条数上限，逐位保存、保留手动断点续抓；修复 500 个 ID 截断和稀疏分页提前结束。暂停/结束同时管理资料与联系队列，不偷偷重启已停止的联系队列。
- 短暂网络/服务器异常退避重试，实际限流、验证、登录/权限异常仍安全暂停；修复成功返回但没有联系方式列表时误报异常的问题。
- 更新方式保持原样：应用内检查 → 用户确认 → 优先增量下载并重建 → 校验 → 空闲时静默安装或退出时安装。旧包缓存缺失、损坏或差分失败才回退完整下载。使用正式更新通道、禁止降级，不覆盖历史发布资产。
- 依赖、数据库结构、图标及数据目录与 1.4.0 保持一致；不用卸载或删库。只有无法发现更新的旧预览版可能需要一次正式安装包覆盖升级，之后继续应用内更新。

### 真实测试边界

发布前复核：79 项离线测试通过、安全扫描 0 项已知漏洞，隐藏启动/IPC、合成旧库与导出兼容、安装包元数据和哈希检查通过。旧新版真实安装包已在本地完成差分重建，复用 90.51%，变化块约 11.65 MB；未执行覆盖安装。详见[复核记录](https://github.com/1Milkdeliver/tiktok-shop-creator-scraper/blob/v1.5.0/docs/release-readiness-1.5.0.md)。

马来西亚小样本保留了 100 位新达人：尝试 95 次联系方式读取，成功 94 次；47 位有 WhatsApp、54 位有邮箱（可重叠），35 位明确未提供。第 95 次遇到验证后停止，6 位仍待检查。列表与联系方式共耗时 16 分 48 秒，联系请求间隔 10 秒；入库/导出回读通过，原有记录保留。本次使用本地团长发现测试适配器，未执行完整详情请求，不代表生产界面已新增团长发现入口。

不承诺无限额度、永不限流或全字段齐全。完整资料补全仍默认关闭、待实测；达人库高级筛选不等于采集前平台条件筛选，任务类目仍是关键词分组。本次联系测试未验证 PPS/GPM、简介、机构、最后发布时间的完整率。Cookie、真实达人、库文件与测试明细不公开发布。
